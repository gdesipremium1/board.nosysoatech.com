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

export type Card = {
  id: string;
  title: string;
  tag: "front" | "backend" | "bug" | "content" | "other";
  meta?: string;
  attachments: Attachment[];
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

const DEFAULT_BOARD: BoardData = {
  projects: [
    {
      id: "nosysoatech",
      name: "nosysoatech.com",
      archived: false,
      columns: [
        {
          id: "todo",
          name: "À faire",
          cards: [
            { id: "c1", title: "Ajouter les balises hreflang sur les 3 langues", tag: "front", meta: "SEO", attachments: [] },
            { id: "c2", title: "Traduire les messages d'erreur de l'API contact selon la langue", tag: "bug", meta: "i18n", attachments: [] },
            { id: "c3", title: "Prendre de vraies captures pour les études de cas", tag: "content", meta: "contenu", attachments: [] },
          ],
        },
        {
          id: "doing",
          name: "En cours",
          cards: [
            { id: "c4", title: "Relecture native des textes malgaches (mg.json)", tag: "content", meta: "i18n", attachments: [] },
            { id: "c5", title: "Brancher Resend en production sur le VPS", tag: "backend", meta: "backend", attachments: [] },
          ],
        },
        { id: "review", name: "En cours de validation", cards: [] },
        {
          id: "done",
          name: "Terminé",
          cards: [
            { id: "c6", title: "Popup de contact avec loading + accusé de réception", tag: "front", meta: "terminé", attachments: [] },
            { id: "c7", title: "Nav fixe, pleine largeur au scroll", tag: "front", meta: "terminé", attachments: [] },
            { id: "c8", title: "Routage FR / EN / MG avec next-intl", tag: "front", meta: "terminé", attachments: [] },
          ],
        },
        { id: "closed", name: "Fermé", cards: [] },
      ],
    },
    { id: "gimoexpert", name: "gimoexpert", archived: false, columns: DEFAULT_COLUMNS() },
    { id: "e-toerana", name: "e-toerana.com", archived: false, columns: DEFAULT_COLUMNS() },
  ],
};

export async function getBoard(): Promise<BoardData> {
  return readJson<BoardData>(DATA_FILE, DEFAULT_BOARD);
}

export async function saveBoard(data: BoardData): Promise<void> {
  return writeJson(DATA_FILE, data);
}
