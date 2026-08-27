"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Attachment, BoardData, Card, Column, Comment, Label, Project } from "@/lib/store";
import RichTextEditor from "@/components/RichTextEditor";
import ClampBlock from "@/components/ClampBlock";
import { PRESET_COLORS } from "@/lib/colors";

function labelPillStyle(color: string): React.CSSProperties {
  return { background: `color-mix(in srgb, ${color} 20%, transparent)`, color };
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function isImage(mime: string) {
  return mime.startsWith("image/");
}

function initials(username: string): string {
  return username.slice(0, 2).toUpperCase();
}

// Deterministic so the same person always gets the same avatar color,
// without needing to store one.
function avatarColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
  return PRESET_COLORS[hash % PRESET_COLORS.length];
}

function formatCommentDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const months = ["jan.", "fév.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${hh}h${mm}`;
}

function cloneCard(card: Card): Card {
  return JSON.parse(JSON.stringify(card));
}

// ---- nesting helpers: cards can be nested to any depth via parentId, and
// a card's descendants can in theory be spread across columns (shouldn't
// normally happen, but these stay defensive rather than assume it never
// will). All take a Project so they work both against the live `board`
// state (for drag-time checks) and against the draft `b` inside
// updateBoard's mutator (for committing a move). ----

function collectSubtreeIds(project: Project, rootId: string): Set<string> {
  const all: Card[] = project.columns.flatMap((c) => c.cards);
  const result = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of all) {
      if (c.parentId && result.has(c.parentId) && !result.has(c.id)) {
        result.add(c.id);
        changed = true;
      }
    }
  }
  return result;
}

function isDescendantOf(project: Project, ancestorId: string, nodeId: string): boolean {
  const all: Card[] = project.columns.flatMap((c) => c.cards);
  let cur = all.find((c) => c.id === nodeId) ?? null;
  while (cur?.parentId) {
    if (cur.parentId === ancestorId) return true;
    cur = all.find((c) => c.id === cur!.parentId) ?? null;
  }
  return false;
}

function findCardInProject(project: Project, id: string): Card | undefined {
  for (const col of project.columns) {
    const found = col.cards.find((c) => c.id === id);
    if (found) return found;
  }
  return undefined;
}

// Where a moved subtree should land when nested under `rootId` (as its
// last child) or reordered right after it as a sibling: just past every
// card already occupying that subtree in the array, regardless of whether
// they happen to sit contiguously.
function indexAfterSubtree(col: Column, rootId: string): number {
  const localIds = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of col.cards) {
      if (c.parentId && localIds.has(c.parentId) && !localIds.has(c.id)) {
        localIds.add(c.id);
        changed = true;
      }
    }
  }
  let maxIdx = -1;
  col.cards.forEach((c, i) => {
    if (localIds.has(c.id)) maxIdx = Math.max(maxIdx, i);
  });
  return maxIdx + 1;
}

type DropTarget = {
  colId: string;
  mode: "before" | "after" | "nest" | "end";
  refCardId: string | null; // null only for mode "end" (append as top-level, at the very end of the column)
} | null;

type Selected = { projectId: string; colId: string; cardId: string };
type Me = { username: string; role: "admin" | "member" };

// The one composer shared by "editing an existing comment" and "replying to
// one" -- the two are mutually exclusive (starting one cancels the other),
// same as in the validated mockup.
type ComposerState = {
  mode: "edit" | "reply";
  targetId: string; // comment being edited, or top-level comment being replied to
  html: string;
  attachments: Attachment[];
  key: number; // remounts the RichTextEditor when a different comment is targeted
  uploadBusy: boolean;
  uploadError: string;
} | null;

export default function Home() {
  const router = useRouter();
  const [board, setBoard] = useState<BoardData | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState("");
  const [addingInCol, setAddingInCol] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [dragoverCol, setDragoverCol] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [draft, setDraft] = useState<Card | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [descEditing, setDescEditing] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [titleEditing, setTitleEditing] = useState(false);
  const [labelFormOpen, setLabelFormOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState(PRESET_COLORS[1]);
  const [labelDropdownOpen, setLabelDropdownOpen] = useState(false);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editLabelName, setEditLabelName] = useState("");
  const [editLabelColor, setEditLabelColor] = useState(PRESET_COLORS[1]);
  const labelDropdownRef = useRef<HTMLDivElement | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [trashOpen, setTrashOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [illegalDropId, setIllegalDropId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [newCommentHtml, setNewCommentHtml] = useState("");
  const [newCommentAttachments, setNewCommentAttachments] = useState<Attachment[]>([]);
  const [newCommentKey, setNewCommentKey] = useState(0);
  const [newCommentUploadBusy, setNewCommentUploadBusy] = useState(false);
  const [newCommentUploadError, setNewCommentUploadError] = useState("");
  const [composer, setComposer] = useState<ComposerState>(null);

  const dragData = useRef<{ cardId: string; fromColId: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const newCommentFileInputRef = useRef<HTMLInputElement | null>(null);
  const composerFileInputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const trashDialogRef = useRef<HTMLDialogElement | null>(null);
  const lightboxRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
    fetch("/api/board")
      .then((r) => r.json())
      .then((data: BoardData) => {
        setBoard(data);
        const firstActive = data.projects.find((p) => !p.archived);
        setActiveProjectId(firstActive?.id ?? "");
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selected) dialogRef.current?.showModal();
  }, [selected]);

  useEffect(() => {
    if (trashOpen) trashDialogRef.current?.showModal();
  }, [trashOpen]);

  useEffect(() => {
    if (lightboxUrl) lightboxRef.current?.showModal();
  }, [lightboxUrl]);

  // Close the label dropdown on an outside click, same as any normal
  // popover -- the dialog's own click handler doesn't help here since a
  // click on the trigger button itself must NOT be swallowed as "outside".
  useEffect(() => {
    if (!labelDropdownOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!labelDropdownRef.current?.contains(e.target as Node)) {
        setLabelDropdownOpen(false);
        setEditingLabelId(null);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [labelDropdownOpen]);

  function closeLightbox() {
    lightboxRef.current?.close();
  }

  function persist(next: BoardData) {
    fetch("/api/board", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        setSaveError("");
      })
      .catch(() => setSaveError("Échec de la sauvegarde — vérifie ta connexion."));
  }

  function updateBoard(mutator: (b: BoardData) => void) {
    setBoard((prev) => {
      if (!prev) return prev;
      const next: BoardData = JSON.parse(JSON.stringify(prev));
      mutator(next);
      persist(next);
      return next;
    });
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const visibleProjects = board?.projects.filter((p) => !p.archived) ?? [];
  const archivedProjects = board?.projects.filter((p) => p.archived) ?? [];
  const activeProject = visibleProjects.find((p) => p.id === activeProjectId);

  function addProject() {
    const name = window.prompt("Nom du nouveau projet :");
    if (!name || !name.trim()) return;
    const id = newId();
    updateBoard((b) => {
      b.projects.push({
        id,
        name: name.trim(),
        archived: false,
        labels: [],
        columns: [
          { id: "todo", name: "À faire", cards: [] },
          { id: "doing", name: "En cours", cards: [] },
          { id: "review", name: "En cours de validation", cards: [] },
          { id: "done", name: "Terminé", cards: [] },
          { id: "closed", name: "Fermé", cards: [] },
        ],
      });
    });
    setActiveProjectId(id);
  }

  function archiveProject(projectId: string) {
    if (!window.confirm("Mettre ce projet à la corbeille ? Tu pourras le restaurer plus tard.")) return;
    updateBoard((b) => {
      const project = b.projects.find((p) => p.id === projectId);
      if (project) {
        project.archived = true;
        project.archivedAt = new Date().toISOString();
      }
    });
    if (projectId === activeProjectId) {
      const next = visibleProjects.find((p) => p.id !== projectId);
      setActiveProjectId(next?.id ?? "");
    }
  }

  function restoreProject(projectId: string) {
    updateBoard((b) => {
      const project = b.projects.find((p) => p.id === projectId);
      if (project) {
        project.archived = false;
        project.archivedAt = undefined;
      }
    });
    setActiveProjectId(projectId);
    trashDialogRef.current?.close();
    setTrashOpen(false);
  }

  function addCard(colId: string) {
    if (!draftTitle.trim() || !activeProjectId) {
      setAddingInCol(null);
      setDraftTitle("");
      return;
    }
    const title = draftTitle.trim();
    updateBoard((b) => {
      const project = b.projects.find((p) => p.id === activeProjectId);
      const col = project?.columns.find((c) => c.id === colId);
      col?.cards.push({ id: newId(), title, attachments: [], comments: [] });
    });
    setDraftTitle("");
    setAddingInCol(null);
  }

  // Moving a card takes its whole subtree along (children, grandchildren,
  // ...), so they always stay nested under it wherever it lands -- a card
  // can become a sibling of another card (mode "before"/"after", same
  // parent as the reference card), a child of one (mode "nest"), or
  // top-level in a column (mode "end").
  function moveSubtree(cardId: string, fromColId: string, target: NonNullable<DropTarget>) {
    if (!activeProjectId) return;
    updateBoard((b) => {
      const project = b.projects.find((p) => p.id === activeProjectId);
      if (!project) return;
      const fromCol = project.columns.find((c) => c.id === fromColId);
      const toCol = project.columns.find((c) => c.id === target.colId);
      if (!fromCol || !toCol) return;

      if (target.mode !== "end") {
        if (!target.refCardId || target.refCardId === cardId) return;
        if (isDescendantOf(project, cardId, target.refCardId)) return; // no cycles
      }

      const idx = fromCol.cards.findIndex((c) => c.id === cardId);
      if (idx === -1) return;
      const [root] = fromCol.cards.splice(idx, 1);

      // Pull every descendant (any depth) out of wherever it currently is.
      const subtreeIds = collectSubtreeIds(project, cardId);
      const descendants: Card[] = [];
      for (const col of project.columns) {
        for (let i = col.cards.length - 1; i >= 0; i--) {
          if (col.cards[i].id !== cardId && subtreeIds.has(col.cards[i].id)) {
            descendants.unshift(...col.cards.splice(i, 1));
          }
        }
      }

      if (target.mode === "nest") root.parentId = target.refCardId!;
      else if (target.mode === "end") root.parentId = undefined;
      else root.parentId = findCardInProject(project, target.refCardId!)?.parentId;

      const moved = [root, ...descendants];
      let insertAt: number;
      if (target.mode === "nest" || target.mode === "after") {
        insertAt = indexAfterSubtree(toCol, target.refCardId!);
      } else if (target.mode === "before") {
        const refIdx = toCol.cards.findIndex((c) => c.id === target.refCardId);
        insertAt = refIdx === -1 ? toCol.cards.length : refIdx;
      } else {
        insertAt = toCol.cards.length;
      }
      toCol.cards.splice(insertAt, 0, ...moved);
    });
  }

  function toggleCollapsed(cardId: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  function commitDrop() {
    const drag = dragData.current;
    const target = dropTarget;
    dragData.current = null;
    setDropTarget(null);
    setIllegalDropId(null);
    setDraggingId(null);
    setDragoverCol(null);
    if (!drag || !target) return;
    moveSubtree(drag.cardId, drag.fromColId, target);
  }

  function onCardDragStart(e: React.DragEvent, card: Card, colId: string) {
    dragData.current = { cardId: card.id, fromColId: colId };
    setDraggingId(card.id);
    e.dataTransfer.effectAllowed = "move";
  }

  function onCardDragOver(e: React.DragEvent, card: Card, colId: string) {
    e.preventDefault();
    e.stopPropagation();
    setDragoverCol(colId);
    const drag = dragData.current;
    if (!drag || drag.cardId === card.id || !activeProject) return;
    if (isDescendantOf(activeProject, drag.cardId, card.id)) {
      setIllegalDropId(card.id);
      setDropTarget(null);
      return;
    }
    setIllegalDropId(null);
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const nesting = relX > 30;
    const next: DropTarget = nesting
      ? { colId, mode: "nest", refCardId: card.id }
      : { colId, mode: relY < rect.height / 2 ? "before" : "after", refCardId: card.id };
    setDropTarget((prev) =>
      prev && prev.mode === next!.mode && prev.refCardId === next!.refCardId && prev.colId === next!.colId
        ? prev
        : next
    );
  }

  function onCardDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    commitDrop();
  }

  function onCardDragEnd() {
    dragData.current = null;
    setDropTarget(null);
    setIllegalDropId(null);
    setDraggingId(null);
    setDragoverCol(null);
  }

  function onColumnDragOver(e: React.DragEvent, colId: string) {
    e.preventDefault();
    setDragoverCol(colId);
    const drag = dragData.current;
    if (!drag) return;
    setIllegalDropId(null);
    setDropTarget((prev) =>
      prev && prev.mode === "end" && prev.colId === colId ? prev : { colId, mode: "end", refCardId: null }
    );
  }

  function onColumnDrop(e: React.DragEvent) {
    e.preventDefault();
    commitDrop();
  }

  function requestOpenCard(colId: string, card: Card) {
    if (!activeProjectId) return;
    if (dirty && !window.confirm("Fermer sans enregistrer ? Les modifications seront perdues.")) {
      return;
    }
    setUploadError("");
    setDescEditing(false);
    setEditingNoteId(null);
    setTitleEditing(false);
    setLabelFormOpen(false);
    setNewLabelName("");
    setNewLabelColor(PRESET_COLORS[1]);
    setLabelDropdownOpen(false);
    setEditingLabelId(null);
    setNewCommentHtml("");
    setNewCommentAttachments([]);
    setNewCommentKey((k) => k + 1);
    setNewCommentUploadError("");
    setComposer(null);
    setSelected({ projectId: activeProjectId, colId, cardId: card.id });
    setDraft(cloneCard(card));
    setDirty(false);
  }

  function requestCloseCard() {
    if (dirty && !window.confirm("Fermer sans enregistrer ? Les modifications seront perdues.")) {
      return;
    }
    dialogRef.current?.close();
  }

  function getLiveCard(): Card | null {
    if (!selected || !board) return null;
    const project = board.projects.find((p) => p.id === selected.projectId);
    const col = project?.columns.find((c) => c.id === selected.colId);
    return col?.cards.find((c) => c.id === selected.cardId) ?? null;
  }

  function updateDraft(mutator: (c: Card) => void) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = cloneCard(prev);
      mutator(next);
      return next;
    });
    setDirty(true);
    setSavedFlash(false);
  }

  function saveCard() {
    if (!selected || !draft) return;
    updateBoard((b) => {
      const project = b.projects.find((p) => p.id === selected.projectId);
      const col = project?.columns.find((c) => c.id === selected.colId);
      const idx = col?.cards.findIndex((c) => c.id === selected.cardId) ?? -1;
      if (col && idx !== -1) {
        col.cards[idx] = { ...col.cards[idx], ...cloneCard(draft) };
      }
    });
    setDirty(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  }

  function deleteCard() {
    if (!selected) return;
    if (!window.confirm("Supprimer cette carte ? Ses sous-tickets seront supprimés aussi.")) return;
    updateBoard((b) => {
      const project = b.projects.find((p) => p.id === selected.projectId);
      if (!project) return;
      const idsToDelete = collectSubtreeIds(project, selected.cardId);
      for (const col of project.columns) {
        col.cards = col.cards.filter((c) => !idsToDelete.has(c.id));
      }
    });
    dialogRef.current?.close();
  }

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selected) return;
    setUploadError("");
    setUploadBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Échec de l'envoi.");
      updateDraft((card) => {
        card.attachments.push(json);
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Échec de l'envoi.");
    } finally {
      setUploadBusy(false);
    }
  }

  function removeAttachment(attachmentId: string) {
    updateDraft((card) => {
      card.attachments = card.attachments.filter((a) => a.id !== attachmentId);
    });
  }

  function updateAttachmentNote(attachmentId: string, note: string) {
    updateDraft((card) => {
      const att = card.attachments.find((a) => a.id === attachmentId);
      if (att) att.note = note;
    });
  }

  // A label belongs to the project (reusable on every other card in it), so
  // creating one commits immediately -- unlike the card's own fields, which
  // wait for "Enregistrer". Applying it to *this* card still goes through
  // the draft, same as picking an existing label from the select.
  function createLabel() {
    const name = newLabelName.trim();
    if (!name || !selected) return;
    const id = newId();
    updateBoard((b) => {
      const project = b.projects.find((p) => p.id === selected.projectId);
      if (!project) return;
      if (!Array.isArray(project.labels)) project.labels = [];
      project.labels.push({ id, name, color: newLabelColor });
    });
    updateDraft((c) => {
      c.labelId = id;
    });
    setNewLabelName("");
    setLabelFormOpen(false);
  }

  // Same reasoning as createLabel: a label is shared project-wide, so
  // renaming/recoloring one commits immediately, not on the card's own
  // "Enregistrer".
  function updateLabel(labelId: string, name: string, color: string) {
    const trimmed = name.trim();
    if (!trimmed || !selected) return;
    updateBoard((b) => {
      const project = b.projects.find((p) => p.id === selected.projectId);
      const label = project?.labels?.find((l) => l.id === labelId);
      if (label) {
        label.name = trimmed;
        label.color = color;
      }
    });
    setEditingLabelId(null);
  }

  // Comments, like labels, commit immediately -- they're a discussion
  // thread, not part of the card's own draft/Enregistrer flow. Posting one
  // (or a reply, or an edit) hits the board straight away.

  function resetNewCommentComposer() {
    setNewCommentHtml("");
    setNewCommentAttachments([]);
    setNewCommentKey((k) => k + 1);
    setNewCommentUploadError("");
  }

  function publishNewComment() {
    if (!selected || !me || !newCommentHtml.trim()) return;
    const comment: Comment = {
      id: newId(),
      authorUsername: me.username,
      createdAt: new Date().toISOString(),
      html: newCommentHtml,
      attachments: newCommentAttachments,
    };
    updateBoard((b) => {
      const project = b.projects.find((p) => p.id === selected.projectId);
      const col = project?.columns.find((c) => c.id === selected.colId);
      const card = col?.cards.find((c) => c.id === selected.cardId);
      card?.comments.push(comment);
    });
    resetNewCommentComposer();
  }

  function startReply(commentId: string) {
    setComposer({ mode: "reply", targetId: commentId, html: "", attachments: [], key: Date.now(), uploadBusy: false, uploadError: "" });
  }

  function startEditComment(comment: Comment) {
    setComposer({
      mode: "edit",
      targetId: comment.id,
      html: comment.html,
      attachments: comment.attachments,
      key: Date.now(),
      uploadBusy: false,
      uploadError: "",
    });
  }

  function cancelComposer() {
    setComposer(null);
  }

  function saveComposer() {
    if (!composer || !selected || !me || !composer.html.trim()) return;
    updateBoard((b) => {
      const project = b.projects.find((p) => p.id === selected.projectId);
      const col = project?.columns.find((c) => c.id === selected.colId);
      const card = col?.cards.find((c) => c.id === selected.cardId);
      if (!card) return;
      if (composer.mode === "edit") {
        const target = card.comments.find((c) => c.id === composer.targetId);
        if (target) {
          target.html = composer.html;
          target.attachments = composer.attachments;
          target.editedAt = new Date().toISOString();
        }
      } else {
        card.comments.push({
          id: newId(),
          authorUsername: me.username,
          createdAt: new Date().toISOString(),
          html: composer.html,
          attachments: composer.attachments,
          parentId: composer.targetId,
        });
      }
    });
    setComposer(null);
  }

  function removeNewCommentAttachment(attachmentId: string) {
    setNewCommentAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
  }

  function removeComposerAttachment(attachmentId: string) {
    setComposer((prev) => (prev ? { ...prev, attachments: prev.attachments.filter((a) => a.id !== attachmentId) } : prev));
  }

  async function uploadFile(file: File): Promise<Attachment> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Échec de l'envoi.");
    return json as Attachment;
  }

  async function handleNewCommentFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setNewCommentUploadError("");
    setNewCommentUploadBusy(true);
    try {
      const att = await uploadFile(file);
      setNewCommentAttachments((prev) => [...prev, att]);
    } catch (err) {
      setNewCommentUploadError(err instanceof Error ? err.message : "Échec de l'envoi.");
    } finally {
      setNewCommentUploadBusy(false);
    }
  }

  async function handleComposerFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !composer) return;
    setComposer((prev) => (prev ? { ...prev, uploadError: "", uploadBusy: true } : prev));
    try {
      const att = await uploadFile(file);
      setComposer((prev) => (prev ? { ...prev, attachments: [...prev.attachments, att], uploadBusy: false } : prev));
    } catch (err) {
      setComposer((prev) =>
        prev ? { ...prev, uploadError: err instanceof Error ? err.message : "Échec de l'envoi.", uploadBusy: false } : prev
      );
    }
  }

  if (loading) {
    return <p style={{ padding: 22, fontFamily: "var(--font-mono)" }}>Chargement…</p>;
  }
  if (!board) {
    return <p style={{ padding: 22 }}>Impossible de charger le tableau.</p>;
  }

  const liveCard = getLiveCard();
  const selectedProject = board.projects.find((p) => p.id === selected?.projectId);
  const subtasks =
    liveCard && board
      ? selectedProject?.columns.find((c) => c.id === selected?.colId)?.cards.filter((c) => c.parentId === liveCard.id) ?? []
      : [];
  const projectLabels: Label[] = activeProject?.labels ?? [];
  const draftLabel = draft ? selectedProject?.labels?.find((l) => l.id === draft.labelId) : undefined;
  // Comments read from the live card, not the draft -- posting/editing one
  // commits immediately (see saveComposer/publishNewComment), same as
  // sub-tickets above.
  const allComments: Comment[] = liveCard?.comments ?? [];
  const topComments = allComments.filter((c) => !c.parentId);

  function findLabel(labelId: string | undefined): Label | undefined {
    return activeProject?.labels?.find((l) => l.id === labelId);
  }

  function repliesOf(commentId: string): Comment[] {
    return allComments.filter((c) => c.parentId === commentId);
  }

  function renderComposerBox(saveLabel: string) {
    if (!composer) return null;
    return (
      <div className="mini-editor">
        <RichTextEditor
          key={composer.key}
          value={composer.html}
          placeholder={composer.mode === "reply" ? "Répondre…" : "Modifier le commentaire…"}
          onSave={(html) => setComposer((prev) => (prev ? { ...prev, html } : prev))}
        />
        {composer.attachments.length > 0 && (
          <div className="c-attachments">
            {composer.attachments.map((a) => (
              <span className="c-chip" key={a.id}>
                📎 {a.filename} <span className="sz">({formatSize(a.size)})</span>
                <button
                  type="button"
                  className="chip-remove"
                  aria-label="Retirer la pièce jointe"
                  onClick={() => removeComposerAttachment(a.id)}
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="mini-actions">
          <button
            type="button"
            className="mini-attach"
            data-busy={composer.uploadBusy}
            onClick={() => composerFileInputRef.current?.click()}
          >
            {composer.uploadBusy ? "Envoi…" : "📎 Joindre"}
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn-mini-cancel" onClick={cancelComposer}>
            Annuler
          </button>
          <button type="button" className="btn-mini-save" disabled={!composer.html.trim()} onClick={saveComposer}>
            {saveLabel}
          </button>
        </div>
        {composer.uploadError && <p className="cd-error">{composer.uploadError}</p>}
      </div>
    );
  }

  function renderComment(c: Comment, isReply: boolean): React.ReactNode {
    const mine = me?.username === c.authorUsername;
    const isEditingThis = composer?.mode === "edit" && composer.targetId === c.id;
    const isReplyingHere = !isReply && composer?.mode === "reply" && composer.targetId === c.id;
    const replies = isReply ? [] : repliesOf(c.id);
    return (
      <div className="comment" key={c.id}>
        <div className="comment-head">
          <div className="avatar" style={{ "--av": avatarColor(c.authorUsername) } as React.CSSProperties}>
            {initials(c.authorUsername)}
          </div>
          <span className="c-author">{c.authorUsername}</span>
          {mine && <span className="c-you">toi</span>}
          <span className="c-date">{formatCommentDate(c.createdAt)}</span>
          {c.editedAt && <span className="c-edited">· modifié</span>}
        </div>

        {isEditingThis ? (
          renderComposerBox("Enregistrer")
        ) : (
          <>
            <ClampBlock html={c.html} lines={4} emptyText="" className="c-body" />
            {c.attachments.length > 0 && (
              <div className="c-attachments">
                {c.attachments.map((a) => (
                  <span className="c-chip" key={a.id}>
                    📎 {a.filename} <span className="sz">({formatSize(a.size)})</span>
                  </span>
                ))}
              </div>
            )}
            <div className="c-actions">
              {!isReply && (
                <button
                  type="button"
                  className="c-action-btn"
                  onClick={() =>
                    composer?.mode === "reply" && composer.targetId === c.id ? cancelComposer() : startReply(c.id)
                  }
                >
                  ↩ Répondre
                </button>
              )}
              {mine && (
                <button type="button" className="c-action-btn" onClick={() => startEditComment(c)}>
                  ✏️ Modifier
                </button>
              )}
            </div>
          </>
        )}

        {isReplyingHere && (
          <div className="c-replies reply-composer">{renderComposerBox("Publier la réponse")}</div>
        )}

        {replies.length > 0 && <div className="c-replies">{replies.map((r) => renderComment(r, true))}</div>}
      </div>
    );
  }

  function renderCardRow(card: Card, colId: string, childCount: number, isCollapsed: boolean) {
    const label = findLabel(card.labelId);
    return (
      <div
        role="button"
        tabIndex={0}
        key={card.id}
        className={
          "card" +
          (illegalDropId === card.id ? " drop-illegal" : "") +
          (draggingId === card.id ? " dragging" : "")
        }
        data-card-id={card.id}
        draggable
        onDragStart={(e) => onCardDragStart(e, card, colId)}
        onDragOver={(e) => onCardDragOver(e, card, colId)}
        onDrop={onCardDrop}
        onDragEnd={onCardDragEnd}
        onClick={() => requestOpenCard(colId, card)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            requestOpenCard(colId, card);
          }
        }}
      >
        <div className="card-row-head">
          <button
            type="button"
            className={"caret" + (childCount === 0 ? " leaf" : "")}
            tabIndex={childCount === 0 ? -1 : 0}
            aria-label={isCollapsed ? "Déplier" : "Replier"}
            onClick={(e) => {
              e.stopPropagation();
              if (childCount > 0) toggleCollapsed(card.id);
            }}
          >
            <span className={"tri" + (isCollapsed ? " collapsed" : "")}>▾</span>
          </button>
          {label && (
            <span className="tag" style={labelPillStyle(label.color)}>
              {label.name}
            </span>
          )}
          <span className="title" style={card.titleColor ? { color: card.titleColor } : undefined}>
            {card.title}
          </span>
          {childCount > 0 && <span className="childcount">{childCount}</span>}
        </div>
        <span className="foot-row">
          <span className="meta">{card.meta || ""}</span>
          <span className="foot-icons">
            {card.description && card.description.replace(/<[^>]+>/g, "").trim() && (
              <span className="clip" title="A une description">
                📝
              </span>
            )}
            {card.attachments.length > 0 && <span className="clip">📎 {card.attachments.length}</span>}
          </span>
        </span>
      </div>
    );
  }

  // Renders one card plus its whole (indented) descendant tree. `allCards`
  // is the flat cards array of the column `card` lives in.
  function renderNode(card: Card, colId: string, allCards: Card[], depth: number): React.ReactNode {
    const kids = allCards.filter((c) => c.parentId === card.id);
    const isCollapsed = collapsedIds.has(card.id);
    return (
      <div className="tree-node" key={card.id}>
        {dropTarget?.mode === "before" && dropTarget.colId === colId && dropTarget.refCardId === card.id && (
          <div className="drop-line" />
        )}
        {renderCardRow(card, colId, kids.length, isCollapsed)}
        {kids.length > 0 && !isCollapsed && (
          <div className="children">{kids.map((k) => renderNode(k, colId, allCards, depth + 1))}</div>
        )}
        {dropTarget?.mode === "nest" && dropTarget.colId === colId && dropTarget.refCardId === card.id && (
          <div className="drop-line nest" />
        )}
        {dropTarget?.mode === "after" && dropTarget.colId === colId && dropTarget.refCardId === card.id && (
          <div className="drop-line" />
        )}
      </div>
    );
  }

  return (
    <>
      <header>
        <div className="wordmark">
          <span className="wm-nosy">nosy</span>
          <span className="wm-soa">soa</span>
          <span className="wm-tech">tech</span>
          <span className="wm-board">/board</span>
          <span className="lock">🔒 privé</span>
        </div>
        <div className="tabs">
          {visibleProjects.map((p) => (
            <div key={p.id} className={"tab-wrap" + (p.id === activeProjectId ? " active" : "")}>
              <button
                type="button"
                className={"tab" + (p.id === activeProjectId ? " active" : "")}
                onClick={() => setActiveProjectId(p.id)}
              >
                {p.name}
              </button>
              {p.id === activeProjectId && (
                <button
                  type="button"
                  className="tab-trash"
                  title="Mettre à la corbeille"
                  onClick={() => archiveProject(p.id)}
                >
                  🗑
                </button>
              )}
            </div>
          ))}
          <button type="button" className="tab-add" onClick={addProject}>
            + projet
          </button>
        </div>
        <button type="button" className="trash-open" onClick={() => setTrashOpen(true)}>
          🗑 Corbeille {archivedProjects.length > 0 ? `(${archivedProjects.length})` : ""}
        </button>
        {me && (
          <div className="user-badge">
            <span>{me.username}</span>
            {me.role === "admin" && (
              <Link className="tab" href="/users">
                Utilisateurs
              </Link>
            )}
            <button type="button" className="tab" onClick={handleLogout}>
              Déconnexion
            </button>
          </div>
        )}
        {saveError && <span className="cd-error">{saveError}</span>}
      </header>

      <div className="board">
        {activeProject?.columns.map((col: Column) => (
          <div className="col" key={col.id}>
            <div className="col-head">
              <span className="name">{col.name}</span>
              <span className="count">{col.cards.filter((c) => !c.parentId).length}</span>
            </div>
            <div
              className={"col-body" + (dragoverCol === col.id ? " dragover" : "")}
              onDragOver={(e) => onColumnDragOver(e, col.id)}
              onDragLeave={() => setDragoverCol((c) => (c === col.id ? null : c))}
              onDrop={onColumnDrop}
            >
              {col.cards
                .filter((c) => !c.parentId)
                .map((card) => renderNode(card, col.id, col.cards, 0))}
              {dropTarget?.mode === "end" && dropTarget.colId === col.id && <div className="drop-line" />}
            </div>
            <div className="quick-add">
              {addingInCol === col.id ? (
                <div className="quick-add-form">
                  <textarea
                    autoFocus
                    rows={2}
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        addCard(col.id);
                      }
                      if (e.key === "Escape") {
                        setAddingInCol(null);
                        setDraftTitle("");
                      }
                    }}
                    placeholder="Titre de la carte…"
                  />
                  <div className="quick-add-actions">
                    <button type="button" className="qa-save" onClick={() => addCard(col.id)}>
                      Ajouter
                    </button>
                    <button
                      type="button"
                      className="qa-cancel"
                      onClick={() => {
                        setAddingInCol(null);
                        setDraftTitle("");
                      }}
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="quick-add-btn"
                  onClick={() => {
                    setAddingInCol(col.id);
                    setDraftTitle("");
                  }}
                >
                  + ajouter une carte
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ---- card detail ---- */}
      <dialog
        ref={dialogRef}
        className="card-modal"
        onClose={() => {
          setSelected(null);
          setDraft(null);
          setDirty(false);
        }}
        onCancel={(e) => {
          if (dirty && !window.confirm("Fermer sans enregistrer ? Les modifications seront perdues.")) {
            e.preventDefault();
          }
        }}
      >
        {draft && (
          <>
            <div className="cd-head">
              <div className="cd-title-wrap">
                <div className="title-row">
                  {titleEditing ? (
                    <input
                      type="text"
                      className="cd-title-input"
                      autoFocus
                      value={draft.title}
                      style={draft.titleColor ? { color: draft.titleColor } : undefined}
                      onChange={(e) => {
                        const value = e.target.value;
                        updateDraft((c) => {
                          c.title = value;
                        });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          setTitleEditing(false);
                        }
                      }}
                    />
                  ) : (
                    <span
                      className="cd-title-view"
                      style={draft.titleColor ? { color: draft.titleColor } : undefined}
                    >
                      {draft.title}
                    </span>
                  )}
                  <button
                    type="button"
                    className={"pen-btn" + (titleEditing ? " editing" : "")}
                    title="Modifier le titre"
                    onClick={() => setTitleEditing((v) => !v)}
                  >
                    {titleEditing ? "✓" : "✏️"}
                  </button>
                  <div className="label-wrap" ref={labelDropdownRef}>
                    <button
                      type="button"
                      className={
                        "label-trigger" +
                        (!draftLabel ? " none" : "") +
                        (labelDropdownOpen ? " open" : "")
                      }
                      style={
                        draftLabel
                          ? ({ "--lbl": draftLabel.color } as React.CSSProperties)
                          : undefined
                      }
                      onClick={() =>
                        setLabelDropdownOpen((v) => {
                          if (v) setEditingLabelId(null);
                          return !v;
                        })
                      }
                    >
                      <span>{draftLabel ? draftLabel.name : "Sans étiquette"}</span>
                      <span className="care">▾</span>
                    </button>

                    {labelDropdownOpen && (
                      <div className="label-dropdown">
                        <div
                          className={"ld-row ld-none" + (!draft.labelId ? " selected" : "")}
                          onClick={() => {
                            updateDraft((c) => {
                              c.labelId = undefined;
                            });
                            setLabelDropdownOpen(false);
                          }}
                        >
                          <span className="ld-dot" style={{ background: "var(--ink-faint)" }} />
                          <span className="ld-name">Sans étiquette</span>
                        </div>
                        <div className="ld-sep" />
                        {projectLabels.map((l) =>
                          editingLabelId === l.id ? (
                            <div className="ld-row-edit" key={l.id}>
                              <input
                                type="text"
                                autoFocus
                                value={editLabelName}
                                maxLength={20}
                                onChange={(e) => setEditLabelName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    updateLabel(l.id, editLabelName, editLabelColor);
                                  }
                                  if (e.key === "Escape") {
                                    e.preventDefault();
                                    setEditingLabelId(null);
                                  }
                                }}
                              />
                              <div className="ld-swatch-row">
                                {PRESET_COLORS.map((c) => (
                                  <button
                                    key={c}
                                    type="button"
                                    className={"ld-swatch" + (editLabelColor === c ? " active" : "")}
                                    style={{ background: c }}
                                    aria-label={`Couleur ${c}`}
                                    onClick={() => setEditLabelColor(c)}
                                  />
                                ))}
                              </div>
                              <div className="ld-edit-actions">
                                <button
                                  type="button"
                                  className="ld-icon-btn cancel"
                                  title="Annuler"
                                  onClick={() => setEditingLabelId(null)}
                                >
                                  ✕
                                </button>
                                <button
                                  type="button"
                                  className="ld-icon-btn confirm"
                                  title="Enregistrer l'étiquette"
                                  disabled={!editLabelName.trim()}
                                  onClick={() => updateLabel(l.id, editLabelName, editLabelColor)}
                                >
                                  ✓
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div
                              className={"ld-row" + (draft.labelId === l.id ? " selected" : "")}
                              key={l.id}
                            >
                              <span
                                className="ld-dot"
                                style={{ background: l.color }}
                                onClick={() => {
                                  updateDraft((c) => {
                                    c.labelId = l.id;
                                  });
                                  setLabelDropdownOpen(false);
                                }}
                              />
                              <span
                                className="ld-name"
                                onClick={() => {
                                  updateDraft((c) => {
                                    c.labelId = l.id;
                                  });
                                  setLabelDropdownOpen(false);
                                }}
                              >
                                {l.name}
                              </span>
                              <button
                                type="button"
                                className="ld-edit-btn"
                                title="Modifier cette étiquette"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingLabelId(l.id);
                                  setEditLabelName(l.name);
                                  setEditLabelColor(l.color);
                                }}
                              >
                                ✏️
                              </button>
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className={"add-label-btn" + (labelFormOpen ? " active" : "")}
                    title="Créer une étiquette"
                    onClick={() => setLabelFormOpen((v) => !v)}
                  >
                    +
                  </button>
                </div>

                {titleEditing && (
                  <div className="title-colors">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={"title-swatch" + (draft.titleColor === c ? " active" : "")}
                        style={{ background: c }}
                        aria-label={`Couleur du titre ${c}`}
                        onClick={() =>
                          updateDraft((card) => {
                            card.titleColor = c;
                          })
                        }
                      />
                    ))}
                    <button
                      type="button"
                      className="title-swatch-clear"
                      title="Retirer la couleur"
                      onClick={() =>
                        updateDraft((card) => {
                          card.titleColor = undefined;
                        })
                      }
                    >
                      &times;
                    </button>
                  </div>
                )}

                {labelFormOpen && (
                  <div className="new-label-form">
                    <div className="new-label-form-head">Nouvelle étiquette pour ce projet</div>
                    <input
                      type="text"
                      value={newLabelName}
                      maxLength={20}
                      placeholder="Nom de l'étiquette…"
                      onChange={(e) => setNewLabelName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          createLabel();
                        }
                      }}
                    />
                    <div className="swatch-row">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={"color-swatch" + (newLabelColor === c ? " active" : "")}
                          style={{ background: c }}
                          aria-label={`Couleur ${c}`}
                          onClick={() => setNewLabelColor(c)}
                        />
                      ))}
                    </div>
                    <div className="form-actions">
                      <button
                        type="button"
                        className="create-btn"
                        disabled={!newLabelName.trim()}
                        onClick={createLabel}
                      >
                        Créer et appliquer
                      </button>
                      <button type="button" className="cancel-btn" onClick={() => setLabelFormOpen(false)}>
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <button type="button" className="cd-close" aria-label="Fermer" onClick={requestCloseCard}>
                &times;
              </button>
            </div>
            <div className="cd-body">
              {draft.meta && (
                <div className="cd-meta-row">
                  <span className="meta">{draft.meta}</span>
                </div>
              )}

              <div>
                <div className="cd-section-label">
                  <span>Description</span>
                  <button
                    type="button"
                    className={"edit-icon" + (descEditing ? " editing" : "")}
                    onClick={() => setDescEditing((v) => !v)}
                  >
                    {descEditing ? "✓ Terminer" : "✏️ Modifier"}
                  </button>
                </div>
                {descEditing ? (
                  <RichTextEditor
                    key={draft.id}
                    value={draft.description ?? ""}
                    onSave={(html) => {
                      updateDraft((c) => {
                        c.description = html;
                      });
                    }}
                  />
                ) : (
                  <ClampBlock
                    html={draft.description || ""}
                    lines={3}
                    emptyText="Aucune description."
                    className="desc-view"
                  />
                )}
              </div>

              <div>
                <div className="cd-section-label">Pièces jointes</div>
                {draft.attachments.length === 0 ? (
                  <p className="attachment-empty">Aucune pièce jointe.</p>
                ) : (
                  <div className="attachment-list">
                    {draft.attachments.map((a) =>
                      isImage(a.mime) ? (
                        <div className="attachment-image" key={a.id}>
                          <img
                            src={a.url}
                            alt={a.filename}
                            className="attach-thumb"
                            onClick={() => setLightboxUrl(a.url)}
                          />
                          <div className="attachment-image-meta">
                            <span className="filename">{a.filename}</span>
                            <span className="size">{formatSize(a.size)}</span>
                            <button
                              type="button"
                              className="remove"
                              aria-label="Retirer"
                              onClick={() => removeAttachment(a.id)}
                            >
                              &times;
                            </button>
                          </div>
                          <div className="note-row">
                            <span className="cd-section-label">Note</span>
                            <button
                              type="button"
                              className={"edit-icon" + (editingNoteId === a.id ? " editing" : "")}
                              onClick={() => setEditingNoteId(editingNoteId === a.id ? null : a.id)}
                            >
                              {editingNoteId === a.id ? "✓ Terminer" : "✏️ Modifier"}
                            </button>
                          </div>
                          {editingNoteId === a.id ? (
                            <textarea
                              className="attach-note"
                              placeholder="Petite note sur cette image…"
                              defaultValue={a.note ?? ""}
                              autoFocus
                              onBlur={(e) => updateAttachmentNote(a.id, e.target.value)}
                            />
                          ) : (
                            <ClampBlock
                              text={a.note || ""}
                              lines={2}
                              emptyText="Aucune note."
                              className="note-view"
                            />
                          )}
                        </div>
                      ) : (
                        <div className="attachment-item" key={a.id}>
                          <a href={a.url} target="_blank" rel="noopener noreferrer">
                            {a.filename}
                          </a>
                          <span className="size">{formatSize(a.size)}</span>
                          <button
                            type="button"
                            className="remove"
                            aria-label="Retirer"
                            onClick={() => removeAttachment(a.id)}
                          >
                            &times;
                          </button>
                        </div>
                      )
                    )}
                  </div>
                )}
                <button
                  type="button"
                  className="upload-btn"
                  data-busy={uploadBusy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadBusy ? "Envoi…" : "+ ajouter une pièce jointe"}
                </button>
                <input ref={fileInputRef} type="file" hidden onChange={handleFileChosen} />
                {uploadError && <p className="cd-error">{uploadError}</p>}
              </div>

              <div>
                <div className="cd-section-label">Sous-tickets</div>
                {subtasks.length === 0 ? (
                  <p className="attachment-empty">
                    Aucun sous-ticket. Glisse une carte du tableau sur celle-ci pour l&apos;imbriquer.
                  </p>
                ) : (
                  <div className="subtask-list">
                    {subtasks.map((s) => {
                      const sLabel = findLabel(s.labelId);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          className="subtask-open"
                          onClick={() => selected && requestOpenCard(selected.colId, s)}
                        >
                          {sLabel && (
                            <span className="tag" style={labelPillStyle(sLabel.color)}>
                              {sLabel.name}
                            </span>
                          )}
                          <span>{s.title}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <div className="cd-section-label">
                  <span>Commentaires</span>
                  {allComments.length > 0 && <span className="count-pill">{allComments.length}</span>}
                </div>
                {topComments.length === 0 ? (
                  <p className="attachment-empty">Aucun commentaire.</p>
                ) : (
                  <div className="comment-list">{topComments.map((c) => renderComment(c, false))}</div>
                )}
                <div className="composer">
                  <div className="composer-head">
                    <div className="avatar" style={{ "--av": avatarColor(me?.username ?? "") } as React.CSSProperties}>
                      {initials(me?.username ?? "?")}
                    </div>
                    <span className="c-author">{me?.username}</span>
                  </div>
                  <RichTextEditor
                    key={newCommentKey}
                    value={newCommentHtml}
                    placeholder="Écrire un commentaire…"
                    onSave={setNewCommentHtml}
                  />
                  {newCommentAttachments.length > 0 && (
                    <div className="c-attachments">
                      {newCommentAttachments.map((a) => (
                        <span className="c-chip" key={a.id}>
                          📎 {a.filename} <span className="sz">({formatSize(a.size)})</span>
                          <button
                            type="button"
                            className="chip-remove"
                            aria-label="Retirer la pièce jointe"
                            onClick={() => removeNewCommentAttachment(a.id)}
                          >
                            &times;
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mini-actions">
                    <button
                      type="button"
                      className="mini-attach"
                      data-busy={newCommentUploadBusy}
                      onClick={() => newCommentFileInputRef.current?.click()}
                    >
                      {newCommentUploadBusy ? "Envoi…" : "📎 Joindre un fichier"}
                    </button>
                    <span style={{ flex: 1 }} />
                    <button type="button" className="btn-mini-cancel" onClick={resetNewCommentComposer}>
                      Effacer
                    </button>
                    <button
                      type="button"
                      className="btn-mini-save"
                      disabled={!newCommentHtml.trim()}
                      onClick={publishNewComment}
                    >
                      Publier
                    </button>
                  </div>
                  {newCommentUploadError && <p className="cd-error">{newCommentUploadError}</p>}
                </div>
                <input ref={newCommentFileInputRef} type="file" hidden onChange={handleNewCommentFile} />
                <input ref={composerFileInputRef} type="file" hidden onChange={handleComposerFile} />
              </div>

              <div className="cd-save-bar">
                <button type="button" className="btn-save" disabled={!dirty} onClick={saveCard}>
                  Enregistrer
                </button>
                <span className="cd-save-status">
                  {dirty ? "Modifications non enregistrées" : savedFlash ? "Enregistré ✓" : ""}
                </span>
              </div>

              <button type="button" className="cd-delete" onClick={deleteCard}>
                Supprimer la carte
              </button>
            </div>
          </>
        )}
      </dialog>

      {/* ---- trash ---- */}
      <dialog ref={trashDialogRef} className="card-modal" onClose={() => setTrashOpen(false)}>
        <div className="cd-head">
          <span className="cd-title">Corbeille</span>
          <button
            type="button"
            className="cd-close"
            aria-label="Fermer"
            onClick={() => {
              trashDialogRef.current?.close();
              setTrashOpen(false);
            }}
          >
            &times;
          </button>
        </div>
        <div className="cd-body">
          {archivedProjects.length === 0 ? (
            <p className="attachment-empty">La corbeille est vide.</p>
          ) : (
            <div className="attachment-list">
              {archivedProjects.map((p) => (
                <div className="attachment-item" key={p.id}>
                  <span style={{ flex: 1 }}>{p.name}</span>
                  <button type="button" className="restore-btn" onClick={() => restoreProject(p.id)}>
                    Restaurer
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </dialog>

      {/* ---- lightbox ---- */}
      <dialog
        ref={lightboxRef}
        className="lightbox"
        onClose={() => setLightboxUrl(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeLightbox();
        }}
      >
        {lightboxUrl && (
          <>
            <button
              type="button"
              className="lightbox-close"
              aria-label="Fermer l'aperçu"
              onClick={closeLightbox}
            >
              &times;
            </button>
            <img src={lightboxUrl} alt="" />
          </>
        )}
      </dialog>
    </>
  );
}
