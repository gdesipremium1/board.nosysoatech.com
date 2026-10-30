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
  IE: "Irlande",
  AU: "Australie",
  NZ: "Nouvelle-Zélande",
  SG: "Singapour",
};

const COUNTRY_ALIASES: Record<string, string> = {
  irlande: "IE",
  ireland: "IE",
  australie: "AU",
  australia: "AU",
  "nouvelle-zelande": "NZ",
  "nouvelle zelande": "NZ",
  "new zealand": "NZ",
  singapour: "SG",
  singapore: "SG",
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

// Canada is the only bilingual market: the language tells Québec from
// English-speaking Canada.
export function countryLabel(code?: string, language?: Language): string {
  if (code === "CA" && language === "en") return "Canada (anglophone)";
  return code ? COUNTRY_LABELS[code] ?? code : "";
}

// Prospecting language. Stored only when it differs from the country's
// default (an English-speaking Canadian prospect), otherwise derived.
export const LANGUAGES = ["fr", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  fr: "Francophone",
  en: "Anglophone",
};

const ENGLISH_COUNTRIES = new Set(["IE", "AU", "NZ", "SG", "GB", "US"]);

export function prospectLanguage(p: { country?: string; language?: Language }): Language {
  if (p.language) return p.language;
  return ENGLISH_COUNTRIES.has(p.country ?? "FR") ? "en" : "fr";
}

// Accepts "en" / "fr" or a label ("Anglophone", "English", "Français").
export function parseLanguage(v: unknown): Language | undefined {
  if (typeof v !== "string") return undefined;
  const k = v.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (["en", "anglophone", "anglais", "english"].includes(k)) return "en";
  if (["fr", "francophone", "francais", "french"].includes(k)) return "fr";
  return undefined;
}

// E-commerce platform of the prospect's site (client-direct prospecting).
// Stored when known; older records only carry it as a tag ("WooCommerce"),
// so the platform is also derived from the tags.
export const PLATFORMS = ["woocommerce", "magento", "prestashop", "shopify", "autre"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS: Record<Platform, string> = {
  woocommerce: "WooCommerce",
  magento: "Magento",
  prestashop: "PrestaShop",
  shopify: "Shopify",
  autre: "Autre",
};

export function parsePlatform(v: unknown): Platform | undefined {
  if (typeof v !== "string") return undefined;
  const k = v.trim().toLowerCase().replace(/\s+/g, "");
  if (k === "woo" || k === "wordpress") return "woocommerce";
  return (PLATFORMS as readonly string[]).includes(k) ? (k as Platform) : undefined;
}

export function prospectPlatform(p: { platform?: Platform; tags?: string[] }): Platform | undefined {
  if (p.platform) return p.platform;
  for (const t of p.tags ?? []) {
    const found = parsePlatform(t);
    if (found && found !== "autre") return found;
  }
  return undefined;
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
  language?: Language;
  platform?: Platform;
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
