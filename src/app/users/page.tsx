"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PublicUser, Role } from "@/lib/auth";
import type { BoardData } from "@/lib/store";

type ProjectOption = { id: string; name: string; archived: boolean };

export default function UsersPage() {
  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openPickerId, setOpenPickerId] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  function load() {
    fetch("/api/users")
      .then((r) => r.json())
      .then(setUsers);
    fetch("/api/board")
      .then((r) => r.json())
      .then((data: BoardData) =>
        setProjects(data.projects.map((p) => ({ id: p.id, name: p.name, archived: p.archived })))
      );
  }

  useEffect(load, []);

  // Close the project picker on an outside click, same pattern as every
  // other popover in this app.
  useEffect(() => {
    if (!openPickerId) return;
    function onPointerDown(e: MouseEvent) {
      if (!pickerRef.current?.contains(e.target as Node)) setOpenPickerId(null);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [openPickerId]);

  // Project access commits immediately on each checkbox toggle -- same
  // "no separate save step" pattern as labels/comments on the board itself.
  async function setUserProjects(id: string, projectIds: string[] | null) {
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectIds }),
    });
    if (res.ok) load();
    else {
      const json = await res.json().catch(() => ({}));
      window.alert(json.error || "Échec de la mise à jour.");
    }
  }

  function toggleProject(u: PublicUser, projectId: string) {
    const current = u.projectIds ?? projects.map((p) => p.id); // unrestricted == everything checked
    const next = current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId];
    setUserProjects(u.id, next);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Échec de la création.");
      setUsername("");
      setPassword("");
      setRole("member");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la création.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Supprimer cet utilisateur ?")) return;
    const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
    if (res.ok) load();
    else {
      const json = await res.json().catch(() => ({}));
      window.alert(json.error || "Échec de la suppression.");
    }
  }

  return (
    <div className="users-page">
      <header>
        <div className="wordmark">
          <span className="wm-nosy">nosy</span>
          <span className="wm-soa">soa</span>
          <span className="wm-tech">tech</span>
          <span className="wm-board">/board</span>
        </div>
        <Link className="tab" href="/">
          ← Retour au tableau
        </Link>
      </header>

      <div className="users-body">
        <h1>Utilisateurs</h1>
        <p className="users-sub">
          Pas d&apos;inscription publique — chaque compte est créé ici, par un administrateur.
        </p>

        <form className="user-form" onSubmit={handleCreate}>
          <label className="field">
            <span>Identifiant</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label className="field">
            <span>Mot de passe</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </label>
          <label className="field">
            <span>Rôle</span>
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="member">Membre</option>
              <option value="admin">Administrateur</option>
            </select>
          </label>
          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? "Création…" : "Créer l'utilisateur"}
          </button>
          {error && <p className="cd-error">{error}</p>}
        </form>

        <div className="user-list">
          {users === null ? (
            <p>Chargement…</p>
          ) : (
            users.map((u) => {
              const unrestricted = u.role === "admin" || u.projectIds === undefined;
              const restrictedIds = u.projectIds ?? [];
              return (
                <div className="user-row" key={u.id}>
                  <span className="user-name">{u.username}</span>
                  <span className={`tag t-${u.role === "admin" ? "front" : "other"}`}>
                    {u.role === "admin" ? "admin" : "membre"}
                  </span>
                  <div className="proj-chips">
                    {unrestricted ? (
                      <span className="proj-chip all">tous les projets</span>
                    ) : restrictedIds.length === 0 ? (
                      <span className="proj-chip none">aucun projet</span>
                    ) : (
                      restrictedIds.map((id) => {
                        const p = projects.find((pr) => pr.id === id);
                        return (
                          <span className="proj-chip" key={id}>
                            {p?.name ?? id}
                          </span>
                        );
                      })
                    )}
                  </div>
                  {u.role !== "admin" && (
                    <div className="proj-picker-wrap" ref={openPickerId === u.id ? pickerRef : undefined}>
                      <button
                        type="button"
                        className="edit-projects"
                        onClick={() => setOpenPickerId(openPickerId === u.id ? null : u.id)}
                      >
                        ✏️ modifier
                      </button>
                      {openPickerId === u.id && (
                        <div className="proj-picker">
                          <div className="proj-picker-head">Projets accessibles</div>
                          <label>
                            <input
                              type="checkbox"
                              checked={unrestricted}
                              onChange={(e) => setUserProjects(u.id, e.target.checked ? null : [])}
                            />
                            Tous les projets
                          </label>
                          <div className="proj-picker-sep" />
                          {projects.map((p) => (
                            <label key={p.id} className={unrestricted ? "disabled" : undefined}>
                              <input
                                type="checkbox"
                                disabled={unrestricted}
                                checked={unrestricted || restrictedIds.includes(p.id)}
                                onChange={() => toggleProject(u, p.id)}
                              />
                              {p.name}
                              {p.archived && <span className="proj-picker-archived"> (corbeille)</span>}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <span className="meta">
                    depuis le {new Date(u.createdAt).toLocaleDateString("fr-FR")}
                  </span>
                  <button type="button" className="remove" onClick={() => handleDelete(u.id)}>
                    &times;
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
