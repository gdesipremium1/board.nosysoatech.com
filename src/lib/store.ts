import path from "path";
import { readJson, writeJson } from "./jsonFile";

export type Attachment = {
  id: string;
  filename: string;
  url: string;
  size: number;
  mime: string;
  uploadedAt: string;
  note?: string;
};

export type Label = {
  id: string;
  name: string;
  color: string;
};

export type Card = {
  id: string;
  title: string;
  titleColor?: string;
  labelId?: string;
  meta?: string;
  description?: string;
  attachments: Attachment[];
  // Sub-tickets are regular cards that reference their parent. They live in
  // the same column.cards array as everything else -- grouping/indenting
  // under the parent is purely a render-time concern (see page.tsx).
  parentId?: string;
};

export type Column = {
  id: string;
  name: string;
  cards: Card[];
};

export type Project = {
  id: string;
  name: string;
  columns: Column[];
  archived: boolean;
  archivedAt?: string;
  // Labels are scoped to a project: created on one card, reusable on every
  // other card in the same project, never shared across projects.
  labels: Label[];
};

export type BoardData = {
  projects: Project[];
};

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "board.json");

export const DEFAULT_COLUMNS = (): Column[] => [
  { id: "todo", name: "À faire", cards: [] },
  { id: "doing", name: "En cours", cards: [] },
  { id: "review", name: "En cours de validation", cards: [] },
  { id: "done", name: "Terminé", cards: [] },
  { id: "closed", name: "Fermé", cards: [] },
];

const DEFAULT_LABELS = (): Label[] => [
  { id: "front", name: "front", color: "#24468f" },
  { id: "bug", name: "bug", color: "#a1650f" },
  { id: "content", name: "contenu", color: "#2f6f4e" },
  { id: "backend", name: "backend", color: "#565f56" },
];

const DEFAULT_BOARD: BoardData = {
  projects: [
    {
      id: "nosysoatech",
      name: "nosysoatech.com",
      archived: false,
      labels: DEFAULT_LABELS(),
      columns: [
        {
          id: "todo",
          name: "À faire",
          cards: [
            { id: "c1", title: "Ajouter les balises hreflang sur les 3 langues", labelId: "front", meta: "SEO", attachments: [] },
            { id: "c2", title: "Traduire les messages d'erreur de l'API contact selon la langue", labelId: "bug", meta: "i18n", attachments: [] },
            { id: "c3", title: "Prendre de vraies captures pour les études de cas", labelId: "content", meta: "contenu", attachments: [] },
          ],
        },
        {
          id: "doing",
          name: "En cours",
          cards: [
            { id: "c4", title: "Relecture native des textes malgaches (mg.json)", labelId: "content", meta: "i18n", attachments: [] },
            { id: "c5", title: "Brancher Resend en production sur le VPS", labelId: "backend", meta: "backend", attachments: [] },
          ],
        },
        { id: "review", name: "En cours de validation", cards: [] },
        {
          id: "done",
          name: "Terminé",
          cards: [
            { id: "c6", title: "Popup de contact avec loading + accusé de réception", labelId: "front", meta: "terminé", attachments: [] },
            { id: "c7", title: "Nav fixe, pleine largeur au scroll", labelId: "front", meta: "terminé", attachments: [] },
            { id: "c8", title: "Routage FR / EN / MG avec next-intl", labelId: "front", meta: "terminé", attachments: [] },
          ],
        },
        { id: "closed", name: "Fermé", cards: [] },
      ],
    },
    { id: "gimoexpert", name: "gimoexpert", archived: false, labels: DEFAULT_LABELS(), columns: DEFAULT_COLUMNS() },
    { id: "e-toerana", name: "e-toerana.com", archived: false, labels: DEFAULT_LABELS(), columns: DEFAULT_COLUMNS() },
  ],
};

export async function getBoard(): Promise<BoardData> {
  return readJson<BoardData>(DATA_FILE, DEFAULT_BOARD);
}

export async function saveBoard(data: BoardData): Promise<void> {
  return writeJson(DATA_FILE, data);
}
