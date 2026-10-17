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
  tags: string[];
  stage: Stage;
  nextAction?: string;
  nextFollowUpAt?: string;
  lastContactAt?: string;
  archived: boolean;
  // Extra imported columns are kept as-is rather than dropped, so an
  // export round-trips whatever the source spreadsheet carried.
  custom: Record<string, string>;
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
};

