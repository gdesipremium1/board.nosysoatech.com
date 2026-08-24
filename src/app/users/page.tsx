"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PublicUser, Role } from "@/lib/auth";

export default function UsersPage() {
  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    fetch("/api/users")
      .then((r) => r.json())
      .then(setUsers);
  }

  useEffect(load, []);

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
            users.map((u) => (
              <div className="user-row" key={u.id}>
                <span className="user-name">{u.username}</span>
                <span className={`tag t-${u.role === "admin" ? "front" : "other"}`}>
                  {u.role === "admin" ? "admin" : "membre"}
                </span>
                <span className="meta">
                  depuis le {new Date(u.createdAt).toLocaleDateString("fr-FR")}
                </span>
                <button type="button" className="remove" onClick={() => handleDelete(u.id)}>
                  &times;
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
