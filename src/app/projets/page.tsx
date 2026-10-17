"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import AppMenu from "@/components/AppMenu";
import type { BoardData, Project } from "@/lib/store";
import "./projets.css";

type Me = { username: string; role: string; avatarUrl?: string };

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

// Same default columns as a project created from the board before this page existed.
function emptyProject(id: string, name: string): Project {
  return {
    id,
    name,
    archived: false,
    labels: [],
    columns: [
      { id: "todo", name: "À faire", cards: [] },
      { id: "doing", name: "En cours", cards: [] },
      { id: "review", name: "En cours de validation", cards: [] },
      { id: "done", name: "Terminé", cards: [] },
      { id: "closed", name: "Fermé", cards: [] },
    ],
  };
}

function cardCount(p: Project): number {
  return p.columns.reduce((n, c) => n + c.cards.length, 0);
}

// Project listing: the "Board" entry of the header menu lands here; a card
// opens that project on the board (/?project=<id>).
export default function ProjetsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [board, setBoard] = useState<BoardData | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const logoTargetRef = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
    fetch("/api/board")
      .then((r) => r.json())
      .then(setBoard)
      .catch(() => setError("Chargement impossible."));
  }, []);

  const canManage = me?.role === "admin" || me?.role === "manager";
  const projects = board?.projects.filter((p) => !p.archived) ?? [];
  const trashCount = board?.projects.filter((p) => p.archived).length ?? 0;

  async function save(next: BoardData) {
    const res = await fetch("/api/board", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!res.ok) throw new Error("Échec de la sauvegarde — vérifie ta connexion.");
    setBoard(next);
  }

  function clone(): BoardData {
    return JSON.parse(JSON.stringify(board));
  }

  async function createProject() {
    if (!board) return;
    const name = window.prompt("Nom du nouveau projet :");
    if (!name || !name.trim()) return;
    const id = newId();
    const next = clone();
    next.projects.push(emptyProject(id, name.trim()));
    try {
      await save(next);
      window.location.href = `/?project=${encodeURIComponent(id)}`;
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function archive(p: Project) {
    if (!board || !window.confirm(`Mettre « ${p.name} » à la corbeille ? Tu pourras le restaurer plus tard.`)) return;
    const next = clone();
    const target = next.projects.find((x) => x.id === p.id);
    if (!target) return;
    target.archived = true;
    target.archivedAt = new Date().toISOString();
    setBusyId(p.id);
    try {
      await save(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function pickLogo(p: Project) {
    logoTargetRef.current = p.id;
    logoInputRef.current?.click();
  }

  async function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const id = logoTargetRef.current;
    if (!file || !id || !board) return;
    if (!file.type.startsWith("image/")) {
      setError("Choisis une image.");
      return;
    }
    setBusyId(id);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Échec de l'envoi.");
      const next = clone();
      const target = next.projects.find((x) => x.id === id);
      if (target) target.logoUrl = json.url;
      await save(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="pj-page">
      <header>
        <div className="wordmark">
          <img src="/logo-icon.png" alt="" className="wm-icon" />
          <span className="wm-nosy">nosy</span>
          <span className="wm-soa">soa</span>
          <span className="wm-tech">tech</span>
          <span className="wm-board">/board</span>
          <span className="lock">🔒 privé</span>
        </div>
        <div className="crumb">
          <span className="crumb-sep">›</span>
          <span className="crumb-name">Projets</span>
        </div>
        {me && <AppMenu current="projets" me={me} trashCount={trashCount} />}
      </header>

      <div className="pj-body">
        <div className="pj-head">
          <h1>Projets</h1>
          <span className="pj-count">{projects.length} projet{projects.length > 1 ? "s" : ""}</span>
          {trashCount > 0 && (
            <Link className="pj-trash-link" href="/?trash=1">🗑 Corbeille ({trashCount})</Link>
          )}
        </div>
        {error && <p className="cd-error" onClick={() => setError("")}>{error}</p>}
        {!board && !error && <p className="pj-empty">Chargement…</p>}

        <input ref={logoInputRef} type="file" accept="image/*" hidden onChange={onLogoFile} />

        {board && (
          <div className="pj-grid">
            {projects.map((p) => {
              const total = cardCount(p);
              return (
                <div key={p.id} className="pj-card">
                  <Link className="pj-open" href={`/?project=${encodeURIComponent(p.id)}`}>
                    <span className="pj-logo">
                      {p.logoUrl ? <img src={p.logoUrl} alt="" /> : p.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="pj-name">{p.name}</span>
                    <span className="pj-total">{total} carte{total > 1 ? "s" : ""}</span>
                    <span className="pj-cols">
                      {p.columns.map((c) => (
                        <span key={c.id} className="pj-col" title={c.name}>
                          <b>{c.cards.length}</b> {c.name}
                        </span>
                      ))}
                    </span>
                  </Link>
                  {canManage && (
                    <div className="pj-actions">
                      <button type="button" disabled={busyId === p.id} onClick={() => pickLogo(p)}>
                        {busyId === p.id ? "…" : p.logoUrl ? "🖼 Changer le logo" : "🖼 Ajouter un logo"}
                      </button>
                      <button type="button" className="danger" disabled={busyId === p.id} onClick={() => archive(p)}>
                        🗑 Corbeille
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            <button type="button" className="pj-card pj-new" onClick={createProject}>
              <span className="pj-new-plus">+</span>
              <span>Nouveau projet</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
