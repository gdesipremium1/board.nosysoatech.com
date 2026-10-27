"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./prospection.css";
import AppMenu from "@/components/AppMenu";
import {
  EVENT_LABELS,
  STAGE_LABELS,
  STAGES,
  STRATEGIES,
  STRATEGY_LABELS,
  countryLabel,
  dueReminders,
  notificationCount,
  type EventType,
  type Prospect,
  type ProspectEvent,
  type Stage,
  type Strategy,
} from "@/lib/prospectionShared";

// Default for a new reminder: tomorrow 9:00 local, formatted for <input type="datetime-local">.
function defaultReminderInput(): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Me = { userId: string; username: string; role: string; avatarUrl?: string };
type View = "pipeline" | "table" | "stats";

// Pipeline columns group a few stages each; "perdu" only shows in the
// table view (or with the stage filter) so the board stays about what's live.
const COLUMNS: { title: string; stages: Stage[] }[] = [
  { title: "À contacter", stages: ["a_contacter"] },
  { title: "Brouillon prêt", stages: ["brouillon"] },
  { title: "Envoyé / relancé", stages: ["envoye", "relance"] },
  { title: "Répondu", stages: ["repondu"] },
  { title: "RDV / Gagné", stages: ["rdv", "gagne"] },
];

const EVENT_ICONS: Partial<Record<EventType, string>> = {
  prospect_created: "＋",
  imported: "⇣",
  draft_created: "✎",
  draft_updated: "✎",
  draft_deleted: "✕",
  send_authorized: "✓",
  email_sent: "➤",
  follow_up_sent: "↻",
  reply_received: "↩",
  message_deleted: "✕",
  meeting_scheduled: "◷",
  won: "★",
  lost: "–",
  note: "•",
  reminder_set: "🔔",
  reminder_done: "✓",
};

function fmtDate(iso?: string, withTime = false): string {
  if (!iso) return "";
  const d = new Date(iso);
  return withTime
    ? d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

// Key milestones of a prospect, read from its history (latest occurrence
// of each), shown as a dated summary at the top of the drawer.
const MILESTONES: { label: string; types: EventType[] }[] = [
  { label: "Brouillon créé", types: ["draft_created", "draft_updated"] },
  { label: "Envoi autorisé", types: ["send_authorized"] },
  { label: "Envoyé", types: ["email_sent"] },
  { label: "Dernière relance", types: ["follow_up_sent"] },
  { label: "Réponse reçue", types: ["reply_received"] },
  { label: "RDV planifié", types: ["meeting_scheduled"] },
];

// Free-text custom fields often carry URLs (sources, LinkedIn searches,
// portals): render those as links, keep the rest as plain text.
function linkify(text: string): React.ReactNode {
  return text.split(/(https?:\/\/[^\s;,]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener">{part.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}</a>
    ) : (
      part
    )
  );
}

function lastOf(events: ProspectEvent[], types: EventType[]): ProspectEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) if (types.includes(events[i].type)) return events[i];
  return undefined;
}

function isFollowUpDue(p: Prospect): boolean {
  return (
    (p.stage === "envoye" || p.stage === "relance") &&
    !!p.nextFollowUpAt &&
    new Date(p.nextFollowUpAt).getTime() <= Date.now()
  );
}

// The draft currently waiting for a decision: last draft event not
// superseded by a send or a deletion.
function pendingDraft(events: ProspectEvent[]): ProspectEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "draft_created" || e.type === "draft_updated") return e;
    if (e.type === "draft_deleted" || e.type === "email_sent" || e.type === "follow_up_sent") return undefined;
  }
  return undefined;
}

function sendAuthorized(events: ProspectEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const t = events[i].type;
    if (t === "send_authorized") return true;
    if (t === "draft_created" || t === "draft_updated" || t === "email_sent" || t === "follow_up_sent") return false;
  }
  return false;
}

const EMPTY_FORM = {
  name: "", strategy: "", country: "", city: "", headcount: "", tier: "", score: "", website: "", emails: "", phones: "",
  linkedin: "", decisionMaker: "", decisionRole: "", decisionEmail: "", source: "", tags: "", nextAction: "",
};
type FormState = typeof EMPTY_FORM;

function toForm(p: Prospect): FormState {
  return {
    name: p.name, strategy: p.strategy ?? "", country: p.country ?? "", city: p.city ?? "", headcount: p.headcount ?? "", tier: p.tier ?? "",
    score: p.score?.toString() ?? "", website: p.website ?? "", emails: p.emails.join("; "),
    phones: p.phones.join("; "), linkedin: p.linkedin ?? "", decisionMaker: p.decisionMaker ?? "",
    decisionRole: p.decisionRole ?? "", decisionEmail: p.decisionEmail ?? "", source: p.source ?? "",
    tags: p.tags.join("; "), nextAction: p.nextAction ?? "",
  };
}

const FORM_FIELDS: { key: keyof FormState; label: string; wide?: boolean }[] = [
  { key: "name", label: "Nom", wide: true },
  { key: "strategy", label: "Stratégie" },
  { key: "country", label: "Pays (code : FR, BE, CH, LU, CA, MC…)" },
  { key: "city", label: "Ville" },
  { key: "headcount", label: "Effectif" },
  { key: "tier", label: "Palier (A/B/C)" },
  { key: "score", label: "Score" },
  { key: "website", label: "Site web", wide: true },
  { key: "emails", label: "Emails (séparés par ;)", wide: true },
  { key: "phones", label: "Téléphones" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "decisionMaker", label: "Décideur" },
  { key: "decisionRole", label: "Fonction" },
  { key: "decisionEmail", label: "Email décideur", wide: true },
  { key: "source", label: "Source" },
  { key: "tags", label: "Tags" },
  { key: "nextAction", label: "Prochaine action", wide: true },
];

export default function ProspectionPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [events, setEvents] = useState<ProspectEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("pipeline");
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState("");
  // "" = toutes, "none" = prospects pas encore classés.
  const [strategy, setStrategy] = useState<Strategy | "" | "none">("");
  const [country, setCountry] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [source, setSource] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [note, setNote] = useState("");
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const [reminderAt, setReminderAt] = useState(defaultReminderInput);
  const [reminderNote, setReminderNote] = useState("");

  useEffect(() => {
    if (!bellOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!bellRef.current?.contains(e.target as Node)) setBellOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [bellOpen]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [sortKey, setSortKey] = useState<"name" | "score" | "stage" | "lastContactAt" | "nextFollowUpAt">("score");
  const [dragId, setDragId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/prospection/prospects");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Chargement impossible.");
      const json = await res.json();
      setProspects(json.prospects);
      setEvents(json.events);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
    load();
  }, [load]);

  const eventsByProspect = useMemo(() => {
    const map = new Map<string, ProspectEvent[]>();
    for (const e of events) {
      const arr = map.get(e.prospectId) ?? [];
      arr.push(e);
      map.set(e.prospectId, arr);
    }
    return map;
  }, [events]);

  const sources = useMemo(
    () => [...new Set(prospects.map((p) => p.source).filter(Boolean) as string[])].sort(),
    [prospects]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return prospects.filter((p) => {
      if (!showArchived && p.archived) return false;
      if (tier && p.tier !== tier) return false;
      if (strategy === "none" ? !!p.strategy : strategy && p.strategy !== strategy) return false;
      if (country && (p.country ?? "FR") !== country) return false;
      if (stageFilter && p.stage !== stageFilter) return false;
      if (source && p.source !== source) return false;
      if (!q) return true;
      return [p.name, p.city, p.decisionMaker, p.website, ...p.emails, ...p.tags]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [prospects, query, tier, strategy, country, stageFilter, source, showArchived]);

  // Counts for the strategy chips (live prospects only, other filters ignored
  // so each chip always tells how big that segment is).
  const strategyCounts = useMemo(() => {
    const live = prospects.filter((p) => showArchived || !p.archived);
    const counts = new Map<string, number>([["", live.length]]);
    for (const p of live) counts.set(p.strategy ?? "none", (counts.get(p.strategy ?? "none") ?? 0) + 1);
    return counts;
  }, [prospects, showArchived]);

  // Same idea per country. Prospects created before the field existed were
  // all French, so a missing country counts as FR.
  const countryCounts = useMemo(() => {
    const live = prospects.filter((p) => showArchived || !p.archived);
    const counts = new Map<string, number>();
    for (const p of live) counts.set(p.country ?? "FR", (counts.get(p.country ?? "FR") ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [prospects, showArchived]);

  const stats = useMemo(() => {
    const live = prospects.filter((p) => !p.archived);
    const contacted = new Set(events.filter((e) => e.type === "email_sent" || e.type === "follow_up_sent").map((e) => e.prospectId));
    const replied = new Set(events.filter((e) => e.type === "reply_received").map((e) => e.prospectId));
    const repliedOfContacted = [...replied].filter((id) => contacted.has(id)).length;
    return {
      total: live.length,
      drafts: live.filter((p) => p.stage === "brouillon").length,
      contacted: contacted.size,
      replyRate: contacted.size ? Math.round((repliedOfContacted / contacted.size) * 100) : 0,
      meetings: live.filter((p) => p.stage === "rdv" || p.stage === "gagne").length,
      due: live.filter(isFollowUpDue).length,
      contactedSet: contacted,
      repliedSet: replied,
    };
  }, [prospects, events]);

  const selected = prospects.find((p) => p.id === selectedId) ?? null;
  const selectedEvents = selected ? eventsByProspect.get(selected.id) ?? [] : [];
  const draft = pendingDraft(selectedEvents);

  async function postEvent(prospectId: string, body: Record<string, unknown>, okMsg?: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/prospection/prospects/${prospectId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Échec de l'enregistrement.");
      setProspects((prev) => prev.map((p) => (p.id === prospectId ? json.prospect : p)));
      setEvents((prev) => [...prev, json.event]);
      if (okMsg) setNotice(okMsg);
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function formPayload(): Record<string, unknown> {
    return { ...form, score: form.score || undefined };
  }

  async function saveForm(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const res = creating
        ? await fetch("/api/prospection/prospects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prospect: formPayload() }),
          })
        : await fetch(`/api/prospection/prospects/${selectedId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formPayload()),
          });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Échec de l'enregistrement.");
      if (creating && json.skipped?.length) setNotice(`« ${json.skipped[0]} » existe déjà.`);
      await load();
      if (creating && json.created?.[0]) setSelectedId(json.created[0].id);
      setCreating(false);
      setEditing(false);
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(file: File) {
    setBusy(true);
    try {
      const text = await file.text();
      let body: Record<string, unknown>;
      if (file.name.toLowerCase().endsWith(".json")) {
        const parsed = JSON.parse(text);
        body = { prospects: Array.isArray(parsed) ? parsed : parsed.prospects ?? [] };
      } else {
        body = { csv: text };
      }
      body.source = file.name.replace(/\.[^.]+$/, "");
      const res = await fetch("/api/prospection/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Import impossible.");
      setNotice(`${json.created.length} prospect(s) importé(s), ${json.skipped.length} doublon(s) ignoré(s).`);
      await load();
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function openProspect(id: string) {
    setSelectedId(id);
    setCreating(false);
    setEditing(false);
    setNote("");
  }

  function startCreate() {
    setSelectedId(null);
    setForm(EMPTY_FORM);
    setCreating(true);
  }

  function onDrop(stage: Stage) {
    const p = prospects.find((x) => x.id === dragId);
    setDragId(null);
    if (!p || p.stage === stage) return;
    postEvent(p.id, { type: "stage_changed", stage, note: `${STAGE_LABELS[p.stage]} → ${STAGE_LABELS[stage]}` });
  }

  function askReply() {
    if (!selected) return;
    const sentiment = window.prompt("Réponse reçue — ton : positive / neutre / negative", "positive");
    if (sentiment === null) return;
    postEvent(selected.id, {
      type: "reply_received",
      sentiment: sentiment.trim().toLowerCase(),
      note: note || undefined,
      channel: "email",
    }, "Réponse enregistrée.");
    setNote("");
  }

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      if (sortKey === "score") return (b.score ?? -1) - (a.score ?? -1);
      if (sortKey === "stage") return STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage);
      if (sortKey === "name") return a.name.localeCompare(b.name);
      return (b[sortKey] ?? "").localeCompare(a[sortKey] ?? "");
    });
    return arr;
  }, [filtered, sortKey]);

  // Everything that "rings" right now: reminders whose date is reached and
  // overdue follow-ups, newest first. Drives the bell and the card badges.
  const notifications = useMemo(() => {
    const now = Date.now();
    const list: { key: string; prospect: Prospect; label: string; at: string }[] = [];
    for (const p of prospects) {
      if (p.archived) continue;
      for (const r of dueReminders(p, now)) {
        list.push({ key: r.id, prospect: p, label: `Rappel : ${r.note || "sans note"}`, at: r.at });
      }
      if (isFollowUpDue(p)) list.push({ key: `${p.id}-fu`, prospect: p, label: "Relance due", at: p.nextFollowUpAt! });
    }
    return list.sort((a, b) => b.at.localeCompare(a.at));
  }, [prospects]);
  const totalNotifications = notifications.length;

  function badges(p: Prospect) {
    const evs = eventsByProspect.get(p.id) ?? [];
    return (
      <div className="px-badges">
        {p.strategy && <span className={`px-pill strat strat-${p.strategy}`}>{STRATEGY_LABELS[p.strategy]}</span>}
        {p.tier && <span className="px-pill">Palier {p.tier}</span>}
        {p.stage === "brouillon" && (sendAuthorized(evs) ? <span className="px-pill good">Envoi autorisé</span> : <span className="px-pill blue">À valider</span>)}
        {isFollowUpDue(p) && <span className="px-pill amber">Relance due</span>}
        {p.archived && <span className="px-pill">Archivé</span>}
      </div>
    );
  }

  return (
    <div className="px-page">
      <header>
        <div className="wordmark">
          <img src="/logo-icon.png" alt="" className="wm-icon" />
          <span className="wm-nosy">nosy</span>
          <span className="wm-soa">soa</span>
          <span className="wm-tech">tech</span>
          <span className="wm-board">/board</span>
        </div>
        <div className="crumb">
          <span className="crumb-sep">›</span>
          <span className="crumb-name">Prospection</span>
        </div>
        <div className="px-bell-wrap" ref={bellRef}>
          <button
            type="button"
            className={"px-bell" + (totalNotifications ? " ringing" : "")}
            onClick={() => setBellOpen((v) => !v)}
            aria-label={`${totalNotifications} notification(s)`}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
              <path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            {totalNotifications > 0 && <span className="notif-badge">{totalNotifications > 99 ? "99+" : totalNotifications}</span>}
          </button>
          {bellOpen && (
            <div className="px-bell-panel">
              <div className="px-bell-head">Notifications</div>
              {notifications.length === 0 && <p className="px-bell-empty">Rien à traiter pour l&apos;instant.</p>}
              {notifications.map((n) => (
                <button
                  key={n.key}
                  type="button"
                  className="px-bell-item"
                  onClick={() => {
                    openProspect(n.prospect.id);
                    setBellOpen(false);
                  }}
                >
                  <b>{n.prospect.name}</b>
                  <span>{n.label}</span>
                  <small>{fmtDate(n.at, true)}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        {me && <AppMenu current="prospection" me={me} />}
      </header>

      <div className="px-body">
        <div className="px-kpis">
          <div className="px-kpi"><span>Prospects</span><b>{stats.total}</b></div>
          <div className="px-kpi"><span>Brouillons prêts</span><b>{stats.drafts}</b></div>
          <div className="px-kpi"><span>Contactés</span><b>{stats.contacted}</b></div>
          <div className="px-kpi"><span>Taux de réponse</span><b>{stats.replyRate} %</b></div>
          <div className="px-kpi"><span>RDV / gagnés</span><b>{stats.meetings}</b></div>
          <div className={"px-kpi" + (stats.due ? " warn" : "")}><span>Relances dues</span><b>{stats.due}</b></div>
        </div>

        <div className="px-strategies" role="group" aria-label="Stratégie">
          {(["", ...STRATEGIES, "none"] as const)
            .filter((s) => s === "" || s === strategy || (strategyCounts.get(s) ?? 0) > 0)
            .map((s) => (
              <button
                key={s || "all"}
                type="button"
                className={"px-strat-chip" + (strategy === s ? " active" : "") + (s && s !== "none" ? ` strat-${s}` : "")}
                onClick={() => setStrategy(s)}
              >
                {s === "" ? "Toutes stratégies" : s === "none" ? "Non classés" : STRATEGY_LABELS[s]}
                <span>{strategyCounts.get(s) ?? 0}</span>
              </button>
            ))}
        </div>

        <div className="px-toolbar">
          <input
            className="px-search"
            placeholder="Rechercher un prospect, une ville, un email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Pays">
            <option value="">Tous pays ({countryCounts.reduce((n, [, c]) => n + c, 0)})</option>
            {countryCounts.map(([code, n]) => (
              <option key={code} value={code}>{countryLabel(code)} ({n})</option>
            ))}
          </select>
          <select value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Palier">
            <option value="">Tous paliers</option>
            <option value="A">Palier A</option>
            <option value="B">Palier B</option>
            <option value="C">Palier C</option>
          </select>
          <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} aria-label="Étape">
            <option value="">Toutes étapes</option>
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </select>
          {sources.length > 0 && (
            <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
              <option value="">Toutes sources</option>
              {sources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <label className="px-check">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Archivés
          </label>
          <div className="px-seg" role="group" aria-label="Vue">
            {(["pipeline", "table", "stats"] as View[]).map((v) => (
              <button key={v} type="button" className={view === v ? "active" : ""} onClick={() => setView(v)}>
                {v === "pipeline" ? "Pipeline" : v === "table" ? "Tableau" : "Statistiques"}
              </button>
            ))}
          </div>
          <input ref={fileRef} type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])} />
          <button type="button" className="tab" onClick={() => fileRef.current?.click()} disabled={busy}>⇡ Importer</button>
          <details className="px-export">
            <summary className="tab">⇣ Exporter</summary>
            <div className="px-export-menu">
              <a href="/api/prospection/export?format=csv&dataset=prospects">Prospects (CSV)</a>
              <a href="/api/prospection/export?format=csv&dataset=events">Historique (CSV)</a>
              <a href="/api/prospection/export?format=json">Tout (JSON)</a>
            </div>
          </details>
          <button type="button" className="px-primary" onClick={startCreate}>＋ Prospect</button>
        </div>

        {notice && (
          <p className="px-notice" onClick={() => setNotice("")}>{notice} <span aria-hidden="true">✕</span></p>
        )}
        {error && <p className="cd-error">{error}</p>}
        {loading && <p className="px-empty">Chargement…</p>}
        {!loading && !error && prospects.length === 0 && (
          <div className="px-empty">
            Aucun prospect pour l&apos;instant. Importe un CSV (le fichier ESN par exemple) ou ajoute-en un.
          </div>
        )}

        {view === "pipeline" && prospects.length > 0 && (
          <div className="px-pipeline">
            {COLUMNS.map((col) => {
              const items = filtered.filter((p) => col.stages.includes(p.stage));
              return (
                <div
                  key={col.title}
                  className={"px-col" + (dragId ? " droppable" : "")}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(col.stages[0])}
                >
                  <div className="px-col-head"><span>{col.title}</span><span>{items.length}</span></div>
                  {items.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      draggable
                      onDragStart={() => setDragId(p.id)}
                      onDragEnd={() => setDragId(null)}
                      className={"px-card" + (p.id === selectedId ? " selected" : "")}
                      onClick={() => openProspect(p.id)}
                    >
                      {notificationCount(p) > 0 && (
                        <span className="notif-badge card" title="Notification(s) à traiter">{notificationCount(p)}</span>
                      )}
                      <b>{p.name}</b>
                      <small>{[p.city, countryLabel(p.country ?? "FR"), p.headcount, p.score !== undefined ? `score ${p.score}` : ""].filter(Boolean).join(" · ")}</small>
                      {p.stage === "brouillon" && (() => {
                        const d = lastOf(eventsByProspect.get(p.id) ?? [], ["draft_created", "draft_updated"]);
                        return d ? <small>Brouillon {fmtDate(d.at)}</small> : null;
                      })()}
                      {p.stage === "relance" && <small>Relancé {fmtDate(p.lastContactAt)}</small>}
                      {p.stage === "envoye" && p.lastContactAt && <small>Envoyé {fmtDate(p.lastContactAt)}</small>}
                      {badges(p)}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {view === "table" && prospects.length > 0 && (
          <div className="px-table-wrap">
            <table className="px-table">
              <thead>
                <tr>
                  <th onClick={() => setSortKey("name")}>Nom</th>
                  <th onClick={() => setSortKey("stage")}>Étape</th>
                  <th>Stratégie</th>
                  <th>Pays</th>
                  <th>Palier</th>
                  <th onClick={() => setSortKey("score")}>Score</th>
                  <th>Ville</th>
                  <th>Effectif</th>
                  <th>Email</th>
                  <th onClick={() => setSortKey("lastContactAt")}>Dernier contact</th>
                  <th onClick={() => setSortKey("nextFollowUpAt")}>Relance</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
                  <tr key={p.id} onClick={() => openProspect(p.id)} className={p.id === selectedId ? "selected" : ""}>
                    <td>
                      <b>{p.name}</b>
                      {notificationCount(p) > 0 && <span className="notif-badge inline">{notificationCount(p)}</span>}
                    </td>
                    <td>{STAGE_LABELS[p.stage]}</td>
                    <td>{p.strategy ? STRATEGY_LABELS[p.strategy] : ""}</td>
                    <td>{countryLabel(p.country ?? "FR")}</td>
                    <td>{p.tier ?? ""}</td>
                    <td>{p.score ?? ""}</td>
                    <td>{p.city ?? ""}</td>
                    <td>{p.headcount ?? ""}</td>
                    <td>{p.emails[0] ?? ""}</td>
                    <td>{fmtDate(p.lastContactAt)}</td>
                    <td className={isFollowUpDue(p) ? "due" : ""}>{fmtDate(p.nextFollowUpAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {view === "stats" && prospects.length > 0 && (
          <div className="px-stats">
            <div className="px-stat-block">
              <h3>Entonnoir</h3>
              {[
                ["Prospects", stats.total],
                ["Contactés", stats.contacted],
                ["Ont répondu", stats.repliedSet.size],
                ["RDV / gagnés", stats.meetings],
              ].map(([label, value]) => (
                <div className="px-bar" key={label as string}>
                  <span>{label}</span>
                  <div><i style={{ width: `${stats.total ? Math.max(2, ((value as number) / stats.total) * 100) : 0}%` }} /></div>
                  <b>{value}</b>
                </div>
              ))}
            </div>
            <div className="px-stat-block">
              <h3>Réponse par stratégie</h3>
              {STRATEGIES.filter((s) => prospects.some((p) => p.strategy === s)).map((s) => {
                const ids = prospects.filter((p) => p.strategy === s).map((p) => p.id);
                const sent = ids.filter((id) => stats.contactedSet.has(id)).length;
                const rep = ids.filter((id) => stats.contactedSet.has(id) && stats.repliedSet.has(id)).length;
                const rate = sent ? Math.round((rep / sent) * 100) : 0;
                return (
                  <div className="px-bar" key={s}>
                    <span>{STRATEGY_LABELS[s]}</span>
                    <div><i style={{ width: `${rate}%` }} /></div>
                    <b>{sent ? `${rate} % (${rep}/${sent})` : `— (${ids.length})`}</b>
                  </div>
                );
              })}
            </div>
            <div className="px-stat-block">
              <h3>Réponse par palier</h3>
              {(["A", "B", "C"] as const).map((t) => {
                const ids = prospects.filter((p) => p.tier === t).map((p) => p.id);
                const sent = ids.filter((id) => stats.contactedSet.has(id)).length;
                const rep = ids.filter((id) => stats.contactedSet.has(id) && stats.repliedSet.has(id)).length;
                const rate = sent ? Math.round((rep / sent) * 100) : 0;
                return (
                  <div className="px-bar" key={t}>
                    <span>Palier {t}</span>
                    <div><i style={{ width: `${rate}%` }} /></div>
                    <b>{sent ? `${rate} % (${rep}/${sent})` : "—"}</b>
                  </div>
                );
              })}
            </div>
            <div className="px-stat-block">
              <h3>Activité des 14 derniers jours</h3>
              <div className="px-spark">
                {Array.from({ length: 14 }, (_, i) => {
                  const day = new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10);
                  const n = events.filter((e) => e.at.slice(0, 10) === day && (e.type === "email_sent" || e.type === "follow_up_sent")).length;
                  const r = events.filter((e) => e.at.slice(0, 10) === day && e.type === "reply_received").length;
                  return (
                    <div key={day} title={`${day} : ${n} envoi(s), ${r} réponse(s)`}>
                      <i style={{ height: `${Math.min(100, n * 10)}%` }} />
                      <em style={{ height: `${Math.min(100, r * 10)}%` }} />
                    </div>
                  );
                })}
              </div>
              <p className="px-legend"><i /> envois <em /> réponses</p>
            </div>
          </div>
        )}
      </div>

      {(selected || creating) && (
        <aside className="px-drawer" aria-label="Fiche prospect">
          <div className="px-drawer-head">
            <div>
              <h2>{creating ? "Nouveau prospect" : selected!.name}</h2>
              {selected && !creating && (
                <small>{[selected.legalForm, selected.city, selected.headcount, selected.siren && `SIREN ${selected.siren}`].filter(Boolean).join(" · ")}</small>
              )}
            </div>
            <button type="button" className="px-close" aria-label="Fermer" onClick={() => { setSelectedId(null); setCreating(false); }}>×</button>
          </div>

          {(creating || editing) ? (
            <form className="px-form" onSubmit={saveForm}>
              {FORM_FIELDS.map((f) => (
                <label key={f.key} className={"field" + (f.wide ? " wide" : "")}>
                  <span>{f.label}</span>
                  {f.key === "strategy" ? (
                    <select value={form.strategy} onChange={(e) => setForm({ ...form, strategy: e.target.value })}>
                      <option value="">Non classé</option>
                      {STRATEGIES.map((s) => <option key={s} value={s}>{STRATEGY_LABELS[s]}</option>)}
                    </select>
                  ) : (
                    <input value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} required={f.key === "name"} />
                  )}
                </label>
              ))}
              <div className="px-actions wide">
                <button type="submit" className="px-primary" disabled={busy}>{busy ? "…" : "Enregistrer"}</button>
                <button type="button" className="tab" onClick={() => { setCreating(false); setEditing(false); }}>Annuler</button>
              </div>
            </form>
          ) : selected && (
            <>
              <div className="px-stage-row">
                <select
                  value={selected.stage}
                  onChange={(e) => postEvent(selected.id, { type: "stage_changed", stage: e.target.value, note: `${STAGE_LABELS[selected.stage]} → ${STAGE_LABELS[e.target.value as Stage]}` })}
                  disabled={busy}
                  aria-label="Étape"
                >
                  {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                </select>
                {badges(selected)}
              </div>

              <div className="px-dates">
                <div><span>Ajouté le</span><b>{fmtDate(selected.createdAt, true)}</b></div>
                {MILESTONES.map((m) => {
                  const e = lastOf(selectedEvents, m.types);
                  return e ? <div key={m.label}><span>{m.label}</span><b>{fmtDate(e.at, true)}</b></div> : null;
                })}
                {selected.nextFollowUpAt && (
                  <div className={isFollowUpDue(selected) ? "due" : ""}><span>Relance prévue</span><b>{fmtDate(selected.nextFollowUpAt)}</b></div>
                )}
              </div>

              <div className="px-reminders">
                <h3 className="px-h3">
                  Rappels
                  {dueReminders(selected).length > 0 && <span className="notif-badge inline">{dueReminders(selected).length}</span>}
                </h3>
                {(selected.reminders ?? []).length === 0 && <p className="px-reminder-empty">Aucun rappel programmé.</p>}
                {[...(selected.reminders ?? [])]
                  .sort((a, b) => Number(a.done) - Number(b.done) || a.at.localeCompare(b.at))
                  .map((r) => {
                    const due = !r.done && new Date(r.at).getTime() <= Date.now();
                    return (
                      <div key={r.id} className={"px-reminder" + (r.done ? " done" : due ? " due" : "")}>
                        <span className="px-reminder-state">{r.done ? "✓ Traité" : due ? "🔔 À traiter" : "◷ À venir"}</span>
                        <span className="px-reminder-date">{fmtDate(r.at, true)}</span>
                        <span className="px-reminder-note">{r.note || "Sans note"}</span>
                        {!r.done && (
                          <button
                            type="button"
                            className="tab"
                            disabled={busy}
                            onClick={() => postEvent(selected.id, { type: "reminder_done", reminderId: r.id, note: r.note }, "Rappel marqué comme traité.")}
                          >
                            Traité
                          </button>
                        )}
                      </div>
                    );
                  })}
                <form
                  className="px-reminder-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!reminderAt) return;
                    postEvent(
                      selected.id,
                      { type: "reminder_set", dueAt: new Date(reminderAt).toISOString(), note: reminderNote.trim() || undefined },
                      "Rappel programmé : la notification s'activera à la date choisie."
                    );
                    setReminderNote("");
                    setReminderAt(defaultReminderInput());
                  }}
                >
                  <input type="datetime-local" value={reminderAt} onChange={(e) => setReminderAt(e.target.value)} required aria-label="Date du rappel" />
                  <input value={reminderNote} onChange={(e) => setReminderNote(e.target.value)} placeholder="Note (ex. relancer si pas de réponse)" aria-label="Note du rappel" />
                  <button type="submit" className="px-primary" disabled={busy}>Programmer</button>
                </form>
              </div>

              <dl className="px-info">
                {selected.decisionMaker && (<><dt>Décideur</dt><dd>{selected.decisionMaker}{selected.decisionRole ? `, ${selected.decisionRole}` : ""}</dd></>)}
                {selected.decisionEmail && (<><dt>Email décideur</dt><dd><a href={`mailto:${selected.decisionEmail}`}>{selected.decisionEmail}</a></dd></>)}
                {selected.emails.length > 0 && (<><dt>Emails</dt><dd>{selected.emails.map((m) => <a key={m} href={`mailto:${m}`}>{m}</a>)}</dd></>)}
                {selected.phones.length > 0 && (<><dt>Téléphones</dt><dd>{selected.phones.join(" · ")}</dd></>)}
                {selected.website && (<><dt>Site</dt><dd><a href={selected.website} target="_blank" rel="noopener">{selected.website.replace(/^https?:\/\//, "")}</a></dd></>)}
                {selected.linkedin && (<><dt>LinkedIn</dt><dd><a href={selected.linkedin} target="_blank" rel="noopener">{selected.linkedin.replace(/^https?:\/\/(www\.)?linkedin\.com/, "")}</a></dd></>)}
                {selected.score !== undefined && (<><dt>Score</dt><dd>{selected.score} / 100{selected.tier ? ` · palier ${selected.tier}` : ""}</dd></>)}
                <dt>Stratégie</dt><dd>{selected.strategy ? STRATEGY_LABELS[selected.strategy] : "Non classé"}</dd>
                <dt>Pays</dt><dd>{countryLabel(selected.country ?? "FR")}</dd>
                {selected.source && (<><dt>Source</dt><dd>{selected.source}</dd></>)}
                {selected.nextAction && (<><dt>Prochaine action</dt><dd>{selected.nextAction}</dd></>)}
                {Object.entries(selected.custom ?? {}).map(([k, v]) => (
                  <span key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{linkify(v)}</dd></span>
                ))}
              </dl>

              {draft && (
                <div className="px-draft">
                  <div className="px-draft-head">✎ Brouillon{draft.channel ? ` (${draft.channel})` : ""} · {fmtDate(draft.at, true)} · {draft.actor}</div>
                  {draft.subject && <b>{draft.subject}</b>}
                  {draft.body && <p>{draft.body}</p>}
                  <div className="px-actions">
                    {!sendAuthorized(selectedEvents) && (
                      <button type="button" className="px-primary" disabled={busy}
                        onClick={() => postEvent(selected.id, { type: "send_authorized", gmailDraftId: draft.gmailDraftId, subject: draft.subject }, "Envoi autorisé : il sera enregistré ici une fois parti.")}>
                        ✓ Autoriser l&apos;envoi
                      </button>
                    )}
                    <button type="button" className="tab" disabled={busy}
                      onClick={() => postEvent(selected.id, { type: "email_sent", channel: draft.channel ?? "email", subject: draft.subject, gmailDraftId: draft.gmailDraftId }, "Envoi enregistré.")}>
                      ➤ Marquer envoyé
                    </button>
                    <button type="button" className="tab danger" disabled={busy}
                      onClick={() => window.confirm("Supprimer ce brouillon ? (l'action reste tracée dans l'historique)") &&
                        postEvent(selected.id, { type: "draft_deleted", gmailDraftId: draft.gmailDraftId, subject: draft.subject }, "Brouillon supprimé.")}>
                      ✕ Supprimer
                    </button>
                  </div>
                </div>
              )}

              <div className="px-actions px-quick">
                <button type="button" className="tab" disabled={busy} onClick={() => postEvent(selected.id, { type: "follow_up_sent", channel: "email", note: note || undefined }, "Relance enregistrée.")}>↻ Relance envoyée</button>
                <button type="button" className="tab" disabled={busy} onClick={askReply}>↩ Réponse reçue</button>
                <button type="button" className="tab" disabled={busy} onClick={() => postEvent(selected.id, { type: "meeting_scheduled", note: note || undefined }, "RDV enregistré.")}>◷ RDV</button>
                <button type="button" className="tab" disabled={busy} onClick={() => postEvent(selected.id, { type: "won", note: note || undefined })}>★ Gagné</button>
                <button type="button" className="tab" disabled={busy} onClick={() => postEvent(selected.id, { type: "lost", note: note || undefined })}>– Perdu</button>
                <button type="button" className="tab" onClick={() => { setForm(toForm(selected)); setEditing(true); }}>✏️ Modifier</button>
                <button type="button" className="tab" disabled={busy} onClick={() => postEvent(selected.id, { type: selected.archived ? "restored" : "archived" })}>
                  {selected.archived ? "Restaurer" : "Archiver"}
                </button>
              </div>

              <div className="px-note">
                <textarea rows={2} placeholder="Note (appel, échange LinkedIn, contexte…)" value={note} onChange={(e) => setNote(e.target.value)} />
                <button type="button" className="tab" disabled={busy || !note.trim()} onClick={() => { postEvent(selected.id, { type: "note", note }); setNote(""); }}>Ajouter</button>
              </div>

              <h3 className="px-h3">Historique</h3>
              <ol className="px-timeline">
                {[...selectedEvents].reverse().map((e) => (
                  <li key={e.id} className={"ev-" + e.type}>
                    <span className="px-ev-icon" aria-hidden="true">{EVENT_ICONS[e.type] ?? "•"}</span>
                    <div>
                      <b>{EVENT_LABELS[e.type]}</b>
                      {e.stage && e.type === "stage_changed" && <> · {STAGE_LABELS[e.stage]}</>}
                      {e.sentiment && <> · {e.sentiment}</>}
                      {e.dueAt && <> · pour le {fmtDate(e.dueAt, true)}</>}
                      {e.subject && <div className="px-ev-subject">{e.subject}</div>}
                      {e.note && <div className="px-ev-note">{e.note}</div>}
                      {e.body && e.type !== "draft_created" && e.type !== "draft_updated" && (
                        <details><summary>Contenu</summary><p>{e.body}</p></details>
                      )}
                      <small>{e.actor} · {fmtDate(e.at, true)}{e.channel ? ` · ${e.channel}` : ""}</small>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </aside>
      )}
    </div>
  );
}
