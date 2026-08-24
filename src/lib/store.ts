import { promises as fs } from "fs";
import path from "path";

export type Attachment = {
  id: string;
  filename: string;
  url: string;
  size: number;
  mime: string;
  uploadedAt: string;
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
};

export type BoardData = {
  projects: Project[];
};

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "board.json");

const DEFAULT_COLUMNS = (): Column[] => [
  { id: "todo", name: "À faire", cards: [] },
  { id: "doing", name: "En cours", cards: [] },
  { id: "done", name: "Terminé", cards: [] },
];

const DEFAULT_BOARD: BoardData = {
  projects: [
    {
      id: "nosysoatech",
      name: "nosysoatech.com",
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
        {
          id: "done",
          name: "Terminé",
          cards: [
            { id: "c6", title: "Popup de contact avec loading + accusé de réception", tag: "front", meta: "terminé", attachments: [] },
            { id: "c7", title: "Nav fixe, pleine largeur au scroll", tag: "front", meta: "terminé", attachments: [] },
            { id: "c8", title: "Routage FR / EN / MG avec next-intl", tag: "front", meta: "terminé", attachments: [] },
          ],
        },
      ],
    },
    { id: "gimoexpert", name: "gimoexpert", columns: DEFAULT_COLUMNS() },
    { id: "e-toerana", name: "e-toerana.com", columns: DEFAULT_COLUMNS() },
  ],
};

let writeQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => undefined);
  return next;
}

export async function getBoard(): Promise<BoardData> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    return JSON.parse(raw) as BoardData;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      await saveBoard(DEFAULT_BOARD);
      return DEFAULT_BOARD;
    }
    throw err;
  }
}

export async function saveBoard(data: BoardData): Promise<void> {
  return enqueue(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
    await fs.rename(tmp, DATA_FILE);
  });
}
