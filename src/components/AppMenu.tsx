"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PRESET_COLORS } from "@/lib/colors";

// Header menu shared by the secondary pages (/projets, /prospection). The
// board itself (src/app/page.tsx) has a richer version of the same menu,
// with the profile editor, participants and trash of the open project.

type Me = { username: string; role: string; avatarUrl?: string };
type Current = "projets" | "prospection";

function avatarColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
  return PRESET_COLORS[hash % PRESET_COLORS.length];
}

export default function AppMenu({ current, me, trashCount }: { current: Current; me: Me; trashCount?: number }) {
  const [open, setOpen] = useState(false);
  const [prospectCount, setProspectCount] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const canManage = me.role === "admin" || me.role === "manager";

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || !canManage) return;
    fetch("/api/prospection/prospects")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json) setProspectCount(json.prospects.filter((p: { archived?: boolean }) => !p.archived).length);
      })
      .catch(() => undefined);
  }, [open, canManage]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <div className="espace-wrap menu-wrap" ref={ref}>
      <button
        type="button"
        className={"menu-trigger" + (open ? " open" : "")}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span
          className="espace-avatar"
          style={!me.avatarUrl ? ({ "--av": avatarColor(me.username) } as React.CSSProperties) : undefined}
        >
          {me.avatarUrl ? <img src={me.avatarUrl} alt="" /> : me.username.slice(0, 2).toUpperCase()}
        </span>
        <span className="menu-trigger-name">{me.username}</span>
        <span className="menu-chevron" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="main-menu" role="menu">
          <Link className={"mm-item" + (current === "projets" ? " mm-current" : "")} href="/projets">
            <span className="mm-icon" aria-hidden="true">▦</span>
            Board
            <span className="mm-meta mm-meta-text">liste des projets</span>
          </Link>
          {canManage && (
            <Link className={"mm-item" + (current === "prospection" ? " mm-current" : "")} href="/prospection">
              <span className="mm-icon" aria-hidden="true">◎</span>
              Prospects
              {prospectCount !== null && <span className="mm-meta">{prospectCount}</span>}
            </Link>
          )}
          {me.role === "admin" && (
            <Link className="mm-item" href="/users">
              <span className="mm-icon" aria-hidden="true">⚙</span>
              Utilisateurs
              <span className="mm-meta mm-meta-text">admin</span>
            </Link>
          )}
          <Link className="mm-item" href="/?trash=1">
            <span className="mm-icon" aria-hidden="true">🗑</span>
            Corbeille
            {!!trashCount && <span className="mm-meta">{trashCount}</span>}
          </Link>
          <div className="mm-sep" />
          <button type="button" className="mm-item mm-logout" onClick={logout}>
            <span className="mm-icon" aria-hidden="true">⏻</span>
            Déconnexion
          </button>
        </div>
      )}
    </div>
  );
}
