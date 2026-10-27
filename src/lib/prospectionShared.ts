// Types and labels shared by the server store (prospection.ts) and the
// client page -- no Node imports here so it can ship to the browser.

export const STAGES = ["a_contacter", "brouillon", "envoye", "relance", "repondu", "rdv", "gagne", "perdu"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  a_contacter: "À contacter",
  brouillon: "Brouillon prêt",
  envoye: "Envoyé",
  relance: "Relancé",
  repondu: "Répondu",
  rdv: "RDV",
  gagne: "Gagné",
  perdu: "Perdu",
};

// Prospecting strategy, i.e. why we target this prospect. "esn" is the
// original campaign (IT services firms buying subcontracting / régie);
// "client_direct" is a business whose site is live and profitable, offered
// audits and fixes directly; "local" groups opportunities around Fort-Dauphin.
export const STRATEGIES = ["esn", "client_direct", "agence", "lims_mes", "recruteur", "local", "candidature", "partenariat", "autre"] as const;
export type Strategy = (typeof STRATEGIES)[number];

export const STRATEGY_LABELS: Record<Strategy, string> = {
  esn: "ESN",
  client_direct: "Client direct",
  agence: "Agence web",
  lims_mes: "LIMS / MES",
  recruteur: "Recruteur",
  local: "Local (Madagascar)",
  candidature: "Candidature",
  partenariat: "Partenariat",
  autre: "Autre",
};

// Accepts an id ("client_direct") or a label as typed in a spreadsheet
// ("Client direct", "client-direct", "ESN"...).
export function parseStrategy(v: unknown): Strategy | undefined {
  if (typeof v !== "string") return undefined;
  const k = v
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s-]+/g, "_");
  if ((STRATEGIES as readonly string[]).includes(k)) return k as Strategy;
  return STRATEGIES.find((s) => STRATEGY_LABELS[s].toLowerCase().replace(/\s+/g, "_") === k);
}

// Prospecting country (ISO 3166-1 alpha-2). Free list rather than an enum so
// a new market can be opened from the API without a deploy; labels cover the
// ones in use, unknown codes are shown as-is.
export const COUNTRY_LABELS: Record<string, string> = {
  FR: "France",
  BE: "Belgique",
  CH: "Suisse",
  LU: "Luxembourg",
  CA: "Québec (Canada)",
  MC: "Monaco",
  MA: "Maroc",
  TN: "Tunisie",
  MG: "Madagascar",
  MU: "Maurice",
};

const COUNTRY_ALIASES: Record<string, string> = {
  france: "FR",
  belgique: "BE",
  belgium: "BE",
  suisse: "CH",
  switzerland: "CH",
  luxembourg: "LU",
  quebec: "CA",
  canada: "CA",
  monaco: "MC",
  maroc: "MA",
  tunisie: "TN",
  madagascar: "MG",
  maurice: "MU",
};

export function countryLabel(code?: string): string {
  return code ? COUNTRY_LABELS[code] ?? code : "";
}

// Accepts an ISO code ("be") or a country name ("Belgique", "Québec").
export function parseCountry(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const k = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s*\(.*\)$/, "");
  return COUNTRY_ALIASES[k];
}

export const EVENT_TYPES = [
  "prospect_created",
  "prospect_updated",
  "imported",
  "draft_created",
  "draft_updated",
  "draft_deleted",
  "send_authorized",
  "email_sent",
  "follow_up_sent",
  "reply_received",
  "message_deleted",
  "meeting_scheduled",
  "won",
  "lost",
  "stage_changed",
  "archived",
  "restored",
  "reminder_set",
  "reminder_done",
  "note",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_LABELS: Record<EventType, string> = {
  prospect_created: "Prospect ajouté",
  prospect_updated: "Fiche modifiée",
  imported: "Importé",
  draft_created: "Brouillon créé",
  draft_updated: "Brouillon modifié",
  draft_deleted: "Brouillon supprimé",
  send_authorized: "Envoi autorisé",
  email_sent: "Message envoyé",
  follow_up_sent: "Relance envoyée",
  reply_received: "Réponse reçue",
  message_deleted: "Message supprimé",
  meeting_scheduled: "RDV planifié",
  won: "Gagné",
  lost: "Perdu",
  stage_changed: "Étape changée",
  archived: "Archivé",
  restored: "Restauré",
  reminder_set: "Rappel programmé",
  reminder_done: "Rappel traité",
  note: "Note",
};

export const CHANNELS = ["email", "linkedin", "telephone", "whatsapp", "formulaire", "autre"] as const;
export type Channel = (typeof CHANNELS)[number];

export type Prospect = {
  id: string;
  name: string;
  siren?: string;
  legalForm?: string;
  city?: string;
  region?: string;
  headcount?: string;
  revenue?: number;
  score?: number;
  tier?: "A" | "B" | "C";
  website?: string;
  emails: string[];
  phones: string[];
  linkedin?: string;
  decisionMaker?: string;
  decisionRole?: string;
  decisionEmail?: string;
  source?: string;
  strategy?: Strategy;
  country?: string;
  tags: string[];
  stage: Stage;
  nextAction?: string;
  nextFollowUpAt?: string;
  lastContactAt?: string;
  archived: boolean;
  // Extra imported columns are kept as-is rather than dropped, so an
  // export round-trips whatever the source spreadsheet carried.
  custom: Record<string, string>;
  // Dated reminders: a reminder only "rings" (counts as a notification) once
  // its date is reached and until it is marked done.
  reminders?: Reminder[];
  createdAt: string;
  updatedAt: string;
};

export type ProspectEvent = {
  id: string;
  prospectId: string;
  type: EventType;
  at: string;
  actor: string;
  channel?: Channel;
  subject?: string;
  body?: string;
  gmailDraftId?: string;
  gmailMessageId?: string;
  gmailThreadId?: string;
  sentiment?: "positive" | "neutre" | "negative";
  stage?: Stage;
  note?: string;
  // reminder_set: when it should ring; reminder_set / reminder_done: which one.
  dueAt?: string;
  reminderId?: string;
};

export type Reminder = {
  id: string;
  at: string;
  note?: string;
  done: boolean;
  doneAt?: string;
};

export function dueReminders(p: Prospect, now = Date.now()): Reminder[] {
  return (p.reminders ?? []).filter((r) => !r.done && new Date(r.at).getTime() <= now);
}

// Notification count shown as a red badge: reminders whose date is reached,
// plus one when the planned follow-up date of a contacted prospect is past.
export function notificationCount(p: Prospect, now = Date.now()): number {
  if (p.archived) return 0;
  const followUpDue =
    (p.stage === "envoye" || p.stage === "relance") &&
    !!p.nextFollowUpAt &&
    new Date(p.nextFollowUpAt).getTime() <= now;
  return dueReminders(p, now).length + (followUpDue ? 1 : 0);
}
