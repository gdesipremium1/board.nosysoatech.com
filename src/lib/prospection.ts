import crypto from "crypto";
import path from "path";
import { readJson, writeJson } from "./jsonFile";

// Prospection CRM -- two JSON files, same storage model as the board:
//  - prospects.json: one record per company/person, current state only.
//  - prospect-events.json: append-only journal. Nothing is ever removed
//    from it -- deleting a draft or archiving a prospect is itself an
//    event. That journal is what makes the data usable for analysis
//    (response rate per tier, per weekday, per channel...).

import {
  CHANNELS,
  EVENT_TYPES,
  STAGES,
  type Channel,
  type EventType,
  type Prospect,
  type ProspectEvent,
  type Reminder,
  type Stage,
  parseCountry,
  parseStrategy,
} from "./prospectionShared";

export * from "./prospectionShared";

const DATA_DIR = path.join(process.cwd(), "data");
const PROSPECTS_FILE = path.join(DATA_DIR, "prospects.json");
const EVENTS_FILE = path.join(DATA_DIR, "prospect-events.json");

const DAY_MS = 24 * 60 * 60 * 1000;

export async function listProspects(): Promise<Prospect[]> {
  return readJson<Prospect[]>(PROSPECTS_FILE, []);
}

export async function listEvents(prospectId?: string): Promise<ProspectEvent[]> {
  const events = await readJson<ProspectEvent[]>(EVENTS_FILE, []);
  return prospectId ? events.filter((e) => e.prospectId === prospectId) : events;
}

function str(v: unknown, max = 500): string | undefined {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const s = String(v).trim().slice(0, max);
  return s || undefined;
}

function list(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[;,\n]/) : [];
  return [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))].slice(0, 20);
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function isoDate(v: unknown): string | undefined {
  const s = str(v, 40);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const EDITABLE_FIELDS = [
  "name", "siren", "legalForm", "city", "region", "headcount", "revenue", "score", "tier", "website",
  "emails", "phones", "linkedin", "decisionMaker", "decisionRole", "decisionEmail", "source", "strategy", "country", "tags",
  "nextAction", "nextFollowUpAt", "custom",
] as const;

// Whitelist + normalisation of anything coming from the UI, the import or
// the API key -- the only way fields reach the stored record.
function applyFields(target: Prospect, input: Record<string, unknown>): void {
  for (const key of EDITABLE_FIELDS) {
    if (!(key in input)) continue;
    const v = input[key];
    switch (key) {
      case "emails":
      case "phones":
      case "tags":
        target[key] = list(v);
        break;
      case "revenue":
      case "score":
        target[key] = num(v);
        break;
      case "tier": {
        const t = str(v, 1)?.toUpperCase();
        target.tier = t === "A" || t === "B" || t === "C" ? t : undefined;
        break;
      }
      case "nextFollowUpAt":
        target.nextFollowUpAt = isoDate(v);
        break;
      case "strategy":
        target.strategy = parseStrategy(v);
        break;
      case "country":
        target.country = parseCountry(v);
        break;
      case "custom":
        if (v && typeof v === "object") {
          target.custom = Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .slice(0, 50)
              .map(([k, val]) => [k.slice(0, 80), String(val ?? "").slice(0, 2000)])
          );
        }
        break;
      case "name":
        target.name = str(v, 200) ?? target.name;
        break;
      default:
        (target as Record<string, unknown>)[key] = str(v, key === "nextAction" ? 300 : 500);
    }
  }
}

function sameCompany(a: Prospect, b: { name?: string; siren?: string }): boolean {
  if (a.siren && b.siren) return a.siren.replace(/\s/g, "") === b.siren.replace(/\s/g, "");
  return !!b.name && a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
}

function newEvent(prospectId: string, type: EventType, actor: string, extra: Partial<ProspectEvent> = {}): ProspectEvent {
  return { id: crypto.randomUUID(), prospectId, type, at: new Date().toISOString(), actor, ...extra };
}

// Pipeline side effects of an event. Kept here (not in the UI) so a
// draft recorded through the API key moves the card exactly like a click.
function applyEventToProspect(p: Prospect, e: ProspectEvent, history: ProspectEvent[]): void {
  const now = Date.now();
  switch (e.type) {
    case "draft_created":
      if (p.stage === "a_contacter") p.stage = "brouillon";
      p.nextAction = "Valider et autoriser l'envoi";
      break;
    case "draft_deleted":
      if (p.stage === "brouillon") {
        const contacted = history.some((h) => h.type === "email_sent" || h.type === "follow_up_sent");
        p.stage = contacted ? "envoye" : "a_contacter";
      }
      break;
    case "send_authorized":
      p.nextAction = "Envoi autorisé, en attente d'envoi";
      break;
    case "email_sent":
      p.stage = "envoye";
      p.lastContactAt = e.at;
      p.nextFollowUpAt = new Date(now + 4 * DAY_MS).toISOString();
      p.nextAction = "Relancer si pas de réponse";
      break;
    case "follow_up_sent":
      p.stage = "relance";
      p.lastContactAt = e.at;
      p.nextFollowUpAt = new Date(now + 6 * DAY_MS).toISOString();
      p.nextAction = "Dernière relance ou clôture";
      break;
    case "reply_received":
      p.stage = "repondu";
      p.nextFollowUpAt = undefined;
      p.nextAction = "Répondre au prospect";
      break;
    case "meeting_scheduled":
      p.stage = "rdv";
      p.nextAction = "Préparer le rendez-vous";
      break;
    case "won":
      p.stage = "gagne";
      p.nextFollowUpAt = undefined;
      p.nextAction = undefined;
      break;
    case "lost":
      p.stage = "perdu";
      p.nextFollowUpAt = undefined;
      p.nextAction = undefined;
      break;
    case "stage_changed":
      if (e.stage) p.stage = e.stage;
      break;
    case "archived":
      p.archived = true;
      break;
    case "restored":
      p.archived = false;
      break;
    case "reminder_set":
      if (e.dueAt) {
        p.reminders = [...(p.reminders ?? []), { id: e.reminderId ?? e.id, at: e.dueAt, note: e.note, done: false }];
      }
      break;
    case "reminder_done":
      p.reminders = (p.reminders ?? []).map((r) => (r.id === e.reminderId ? { ...r, done: true, doneAt: e.at } : r));
      break;
  }
}

function cleanReminders(v: unknown): Reminder[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Reminder[] = [];
  for (const raw of v.slice(0, 100)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = str(r.id, 100);
    const at = isoDate(r.at);
    if (!id || !at) continue;
    out.push({ id, at, note: str(r.note, 1000), done: r.done === true, doneAt: isoDate(r.doneAt) });
  }
  return out;
}

// Full restore of an export (GET /api/prospection/export?format=json), e.g.
// to move a local board to the online one. Unlike createProspects/addEvent,
// ids, stages, dates and actors are kept as they are, so the history reads
// exactly like the source. Records whose id already exists are skipped,
// never overwritten, which makes a re-run harmless.
export async function importFull(
  data: { prospects?: unknown; events?: unknown },
  actor: string
): Promise<{ prospects: number; events: number; skippedProspects: number; skippedEvents: number }> {
  const prospects = await listProspects();
  const events = await listEvents();
  const prospectIds = new Set(prospects.map((p) => p.id));
  const eventIds = new Set(events.map((e) => e.id));
  const now = new Date().toISOString();
  let addedP = 0;
  let skippedP = 0;
  let addedE = 0;
  let skippedE = 0;

  for (const raw of (Array.isArray(data.prospects) ? data.prospects : []).slice(0, 5000)) {
    if (!raw || typeof raw !== "object") continue;
    const input = raw as Record<string, unknown>;
    const id = str(input.id, 100);
    const name = str(input.name, 200);
    if (!id || !name) continue;
    if (prospectIds.has(id)) {
      skippedP++;
      continue;
    }
    const stage = str(input.stage, 20) as Stage | undefined;
    const p: Prospect = {
      id,
      name,
      emails: [],
      phones: [],
      tags: [],
      stage: stage && STAGES.includes(stage) ? stage : "a_contacter",
      archived: input.archived === true,
      custom: {},
      createdAt: isoDate(input.createdAt) ?? now,
      updatedAt: isoDate(input.updatedAt) ?? now,
    };
    applyFields(p, input);
    p.lastContactAt = isoDate(input.lastContactAt);
    p.reminders = cleanReminders(input.reminders);
    prospects.push(p);
    prospectIds.add(id);
    addedP++;
  }

  for (const raw of (Array.isArray(data.events) ? data.events : []).slice(0, 50000)) {
    if (!raw || typeof raw !== "object") continue;
    const input = raw as Record<string, unknown>;
    const id = str(input.id, 100);
    const prospectId = str(input.prospectId, 100);
    const type = input.type as EventType;
    if (!id || !prospectId || !prospectIds.has(prospectId) || !EVENT_TYPES.includes(type)) continue;
    if (eventIds.has(id)) {
      skippedE++;
      continue;
    }
    const channel = str(input.channel, 20) as Channel | undefined;
    const sentiment = str(input.sentiment, 10) as ProspectEvent["sentiment"];
    const stage = str(input.stage, 20) as Stage | undefined;
    events.push({
      id,
      prospectId,
      type,
      at: isoDate(input.at) ?? now,
      actor: str(input.actor, 40) ?? actor,
      channel: channel && CHANNELS.includes(channel) ? channel : undefined,
      subject: str(input.subject, 300),
      body: str(input.body, 20000),
      gmailDraftId: str(input.gmailDraftId, 200),
      gmailMessageId: str(input.gmailMessageId, 200),
      gmailThreadId: str(input.gmailThreadId, 200),
      sentiment: sentiment && ["positive", "neutre", "negative"].includes(sentiment) ? sentiment : undefined,
      stage: stage && STAGES.includes(stage) ? stage : undefined,
      note: str(input.note, 5000),
      dueAt: isoDate(input.dueAt),
      reminderId: str(input.reminderId, 100),
    });
    eventIds.add(id);
    addedE++;
  }

  events.sort((a, b) => a.at.localeCompare(b.at));
  await writeJson(PROSPECTS_FILE, prospects);
  await writeJson(EVENTS_FILE, events);
  return { prospects: addedP, events: addedE, skippedProspects: skippedP, skippedEvents: skippedE };
}

export async function createProspects(
  inputs: Record<string, unknown>[],
  actor: string,
  opts: { imported?: boolean; source?: string } = {}
): Promise<{ created: Prospect[]; skipped: string[] }> {
  const prospects = await listProspects();
  const events = await listEvents();
  const created: Prospect[] = [];
  const skipped: string[] = [];
  const now = new Date().toISOString();

  for (const input of inputs.slice(0, 5000)) {
    const name = str(input.name, 200);
    if (!name) continue;
    const siren = str(input.siren, 20);
    if (prospects.some((p) => sameCompany(p, { name, siren }))) {
      skipped.push(name);
      continue;
    }
    const p: Prospect = {
      id: crypto.randomUUID(),
      name,
      emails: [],
      phones: [],
      tags: [],
      stage: "a_contacter",
      archived: false,
      custom: {},
      createdAt: now,
      updatedAt: now,
    };
    applyFields(p, input);
    if (!p.source && opts.source) p.source = opts.source;
    prospects.push(p);
    created.push(p);
    events.push(
      newEvent(p.id, opts.imported ? "imported" : "prospect_created", actor, {
        note: p.source ? `Source : ${p.source}` : undefined,
      })
    );
  }
  await writeJson(PROSPECTS_FILE, prospects);
  await writeJson(EVENTS_FILE, events);
  return { created, skipped };
}

export async function updateProspect(id: string, input: Record<string, unknown>, actor: string): Promise<Prospect> {
  const prospects = await listProspects();
  const p = prospects.find((x) => x.id === id);
  if (!p) throw new Error("Prospect introuvable.");
  const before = JSON.stringify(p);
  applyFields(p, input);
  if (JSON.stringify(p) === before) return p;
  p.updatedAt = new Date().toISOString();
  await writeJson(PROSPECTS_FILE, prospects);
  const events = await listEvents();
  events.push(newEvent(id, "prospect_updated", actor, { note: Object.keys(input).filter((k) => k !== "id").join(", ") }));
  await writeJson(EVENTS_FILE, events);
  return p;
}

export async function addEvent(
  prospectId: string,
  input: Record<string, unknown>,
  actor: string
): Promise<{ event: ProspectEvent; prospect: Prospect }> {
  const type = input.type as EventType;
  if (!EVENT_TYPES.includes(type)) throw new Error("Type d'événement inconnu.");
  const prospects = await listProspects();
  const p = prospects.find((x) => x.id === prospectId);
  if (!p) throw new Error("Prospect introuvable.");

  const stage = str(input.stage, 20) as Stage | undefined;
  const channel = str(input.channel, 20) as Channel | undefined;
  const sentiment = str(input.sentiment, 10) as ProspectEvent["sentiment"];
  const event = newEvent(prospectId, type, actor, {
    channel: channel && CHANNELS.includes(channel) ? channel : undefined,
    subject: str(input.subject, 300),
    body: str(input.body, 20000),
    gmailDraftId: str(input.gmailDraftId, 200),
    gmailMessageId: str(input.gmailMessageId, 200),
    gmailThreadId: str(input.gmailThreadId, 200),
    sentiment: sentiment && ["positive", "neutre", "negative"].includes(sentiment) ? sentiment : undefined,
    stage: stage && STAGES.includes(stage) ? stage : undefined,
    note: str(input.note, 5000),
    dueAt: isoDate(input.dueAt),
    reminderId: str(input.reminderId, 100),
  });
  if (type === "stage_changed" && !event.stage) throw new Error("Étape cible manquante.");
  if (type === "reminder_set" && !event.dueAt) throw new Error("Date du rappel manquante.");
  if (type === "reminder_done" && !(p.reminders ?? []).some((r) => r.id === event.reminderId)) {
    throw new Error("Rappel introuvable.");
  }

  const events = await listEvents();
  applyEventToProspect(p, event, events.filter((e) => e.prospectId === prospectId));
  p.updatedAt = event.at;
  events.push(event);
  await writeJson(EVENTS_FILE, events);
  await writeJson(PROSPECTS_FILE, prospects);
  return { event, prospect: p };
}

// ---- CSV (import/export) ----

const PROSPECT_COLUMNS: (keyof Prospect)[] = [
  "id", "name", "siren", "legalForm", "city", "region", "headcount", "revenue", "score", "tier", "website",
  "emails", "phones", "linkedin", "decisionMaker", "decisionRole", "decisionEmail", "source", "strategy", "country", "tags",
  "stage", "nextAction", "nextFollowUpAt", "lastContactAt", "archived", "createdAt", "updatedAt",
];
const EVENT_COLUMNS: (keyof ProspectEvent)[] = [
  "id", "prospectId", "type", "at", "actor", "channel", "subject", "body", "gmailDraftId", "gmailMessageId",
  "gmailThreadId", "sentiment", "stage", "note", "dueAt", "reminderId",
];

function csvCell(v: unknown): string {
  const s = Array.isArray(v) ? v.join(";") : v === undefined || v === null ? "" : String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function prospectsToCsv(prospects: Prospect[]): string {
  const customKeys = [...new Set(prospects.flatMap((p) => Object.keys(p.custom ?? {})))];
  const header = [...PROSPECT_COLUMNS, ...customKeys.map((k) => `custom.${k}`)];
  const rows = prospects.map((p) => [
    ...PROSPECT_COLUMNS.map((c) => csvCell(p[c])),
    ...customKeys.map((k) => csvCell(p.custom?.[k])),
  ]);
  return [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

export function eventsToCsv(events: ProspectEvent[], prospects: Prospect[]): string {
  const names = new Map(prospects.map((p) => [p.id, p.name]));
  const header = [...EVENT_COLUMNS, "prospectName"];
  const rows = events.map((e) => [...EVENT_COLUMNS.map((c) => csvCell(e[c])), csvCell(names.get(e.prospectId))]);
  return [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

// RFC4180-ish parser, auto-detecting "," vs ";" (French Excel exports use ";").
export function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...data] = rows.filter((r) => r.some((c) => c.trim()));
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return data.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

// Maps common column names (our own export, the ESN Excel sheet, generic
// CRM exports) onto prospect fields; anything unrecognised goes to custom.
const ALIASES: Record<string, string> = {
  name: "name", nom: "name", "raison sociale": "name", societe: "name", "société": "name", entreprise: "name", company: "name",
  siren: "siren", "forme juridique": "legalForm", legalform: "legalForm",
  ville: "city", city: "city", "région": "region", region: "region",
  effectif: "headcount", headcount: "headcount", "ca (€)": "revenue", revenue: "revenue",
  "score /100": "score", "score sérieux /100": "score", score: "score", palier: "tier", tier: "tier",
  "site web": "website", website: "website", site: "website",
  "email(s) publiés par la société": "emails", "email société": "emails", emails: "emails", email: "emails",
  "téléphone(s) standard": "phones", "téléphone société": "phones", phones: "phones", telephone: "phones", "téléphone": "phones",
  "linkedin entreprise": "linkedin", linkedin: "linkedin",
  "décideur principal (registre)": "decisionMaker", "décisionnaire ciblé": "decisionMaker", decisionmaker: "decisionMaker",
  fonction: "decisionRole", "poste décisionnaire": "decisionRole", decisionrole: "decisionRole",
  "email décideur (à enrichir)": "decisionEmail", "email décisionnaire": "decisionEmail", decisionemail: "decisionEmail",
  source: "source", tags: "tags", "prochaine action": "nextAction", nextaction: "nextAction",
  strategy: "strategy", "stratégie": "strategy", strategie: "strategy",
  country: "country", pays: "country",
};

export function rowsToProspectInputs(rows: Record<string, string>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    const custom: Record<string, string> = {};
    for (const [rawKey, value] of Object.entries(row)) {
      if (!value) continue;
      const key = rawKey.trim();
      if (key.startsWith("custom.")) {
        custom[key.slice(7)] = value;
        continue;
      }
      const field = ALIASES[key.toLowerCase()];
      if (field) out[field] = field in out ? `${out[field]};${value}` : value;
      else if (!["id", "stage", "archived", "createdAt", "updatedAt", "lastContactAt", "#"].includes(key)) custom[key] = value;
    }
    if (Object.keys(custom).length) out.custom = custom;
    return out;
  });
}
