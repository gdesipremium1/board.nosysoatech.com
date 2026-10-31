"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppMenu from "@/components/AppMenu";
import { notificationCount, type Prospect } from "@/lib/prospectionShared";
import type { BoardData } from "@/lib/store";
import "./home.css";

// Home: one tile per area of the app. Tiles follow the same access rules as
// the middleware (prospection: admin/manager, users: admin) so nobody sees a
// door that redirects them back here.

type Me = { username: string; role: string; avatarUrl?: string };

export default function HomePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [projectCount, setProjectCount] = useState<number | null>(null);
  const [prospects, setProspects] = useState<{ total: number; due: number } | null>(null);
  const [userCount, setUserCount] = useState<number | null>(null);

  const canManage = me?.role === "admin" || me?.role === "manager";
  const isAdmin = me?.role === "admin";

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
    fetch("/api/board")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: BoardData | null) => {
        if (data) setProjectCount(data.projects.filter((p) => !p.archived).length);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!canManage) return;
    fetch("/api/prospection/prospects")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!json) return;
        const live = (json.prospects as Prospect[]).filter((p) => !p.archived);
        setProspects({ total: live.length, due: live.reduce((n, p) => n + notificationCount(p), 0) });
      })
      .catch(() => undefined);
  }, [canManage]);

  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/users")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const list = Array.isArray(json) ? json : json?.users;
        if (Array.isArray(list)) setUserCount(list.length);
      })
      .catch(() => undefined);
  }, [isAdmin]);

  return (
    <div className="home-page">
      <header>
        <div className="wordmark">
          <img src="/logo-icon.png" alt="" className="wm-icon" />
          <span className="wm-nosy">nosy</span>
          <span className="wm-soa">soa</span>
          <span className="wm-tech">tech</span>
          <span className="wm-board">/board</span>
          <span className="lock">🔒 privé</span>
        </div>
        {me && <AppMenu current="accueil" me={me} />}
      </header>

      <main className="home-body">
        <h1>{me ? `Bonjour ${me.username}` : "Bienvenue"}</h1>
        <p className="home-sub">Où voulez-vous aller ?</p>

        <div className="home-grid">
          <Link href="/projets" className="home-tile tile-board">
            <BoardArt />
            <span className="home-title">Board</span>
            <span className="home-desc">Projets, cartes et suivi des tâches</span>
            {projectCount !== null && (
              <span className="home-meta">
                {projectCount} projet{projectCount > 1 ? "s" : ""}
              </span>
            )}
          </Link>

          {canManage && (
            <Link href="/prospection" className="home-tile tile-prospects">
              <ProspectsArt />
              <span className="home-title">Prospects</span>
              <span className="home-desc">Pipeline, relances et statistiques</span>
              {prospects && (
                <span className="home-meta">
                  {prospects.total} prospect{prospects.total > 1 ? "s" : ""}
                  {prospects.due > 0 && <span className="home-badge">{prospects.due} à traiter</span>}
                </span>
              )}
            </Link>
          )}

          {isAdmin && (
            <Link href="/users" className="home-tile tile-users">
              <UsersArt />
              <span className="home-title">Utilisateurs</span>
              <span className="home-desc">Comptes, rôles et accès</span>
              {userCount !== null && (
                <span className="home-meta">
                  {userCount} compte{userCount > 1 ? "s" : ""}
                </span>
              )}
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}

// Illustrations: flat SVG drawn with the theme colors (light and dark).

function BoardArt() {
  return (
    <svg className="home-art" viewBox="0 0 160 96" aria-hidden="true">
      <rect x="4" y="6" width="44" height="84" rx="6" className="art-col" />
      <rect x="58" y="6" width="44" height="84" rx="6" className="art-col" />
      <rect x="112" y="6" width="44" height="84" rx="6" className="art-col" />
      <rect x="10" y="14" width="32" height="16" rx="3" className="art-blue" />
      <rect x="10" y="36" width="32" height="12" rx="3" className="art-amber" />
      <rect x="10" y="54" width="32" height="14" rx="3" className="art-card" />
      <rect x="64" y="14" width="32" height="20" rx="3" className="art-amber" />
      <rect x="64" y="40" width="32" height="12" rx="3" className="art-card" />
      <rect x="118" y="14" width="32" height="12" rx="3" className="art-good" />
      <rect x="118" y="32" width="32" height="16" rx="3" className="art-good" />
      <path d="M124 72 l6 6 l12 -14" className="art-check" />
    </svg>
  );
}

function ProspectsArt() {
  return (
    <svg className="home-art" viewBox="0 0 160 96" aria-hidden="true">
      <line x1="8" y1="86" x2="152" y2="86" className="art-axis" />
      <rect x="14" y="58" width="16" height="28" rx="3" className="art-blue" />
      <rect x="38" y="44" width="16" height="42" rx="3" className="art-blue" />
      <rect x="62" y="50" width="16" height="36" rx="3" className="art-blue" />
      <rect x="86" y="30" width="16" height="56" rx="3" className="art-amber" />
      <polyline points="22,48 46,36 70,40 94,20 118,26 142,10" className="art-line" />
      <circle cx="142" cy="10" r="5" className="art-good" />
      <circle cx="132" cy="62" r="18" className="art-ring" />
      <circle cx="132" cy="62" r="10" className="art-ring" />
      <circle cx="132" cy="62" r="3.5" className="art-amber" />
    </svg>
  );
}

function UsersArt() {
  return (
    <svg className="home-art" viewBox="0 0 160 96" aria-hidden="true">
      <circle cx="50" cy="34" r="13" className="art-amber" />
      <path d="M26 84 a24 22 0 0 1 48 0 z" className="art-amber" />
      <circle cx="110" cy="34" r="13" className="art-good" />
      <path d="M86 84 a24 22 0 0 1 48 0 z" className="art-good" />
      <circle cx="80" cy="28" r="15" className="art-blue" />
      <path d="M52 88 a28 25 0 0 1 56 0 z" className="art-blue" />
      <rect x="118" y="6" width="34" height="22" rx="5" className="art-card" />
      <path d="M127 17 l5 5 l10 -10" className="art-check" />
    </svg>
  );
}
