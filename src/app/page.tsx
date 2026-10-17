"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Attachment, BoardData, Card, CardLang, Column, Comment, Label, Project } from "@/lib/store";
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

// Stored role values stay admin/manager/member (see src/lib/auth.ts); only
// the label shown to people changed -- "member" reads as "participant".
function roleLabel(role: "admin" | "manager" | "member"): string {
  if (role === "admin") return "admin";
  if (role === "manager") return "manager";
  return "participant";
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

// ---- translation helpers ----------------------------------------------
// MyMemory (see /api/translate) only speaks plain text, not HTML, and only
// one string at a time. These convert this app's rich text to/from plain
// strings for that round trip. The trade-off is explicit and deliberate:
// paragraph breaks survive, but inline formatting (bold, color, headings,
// list markup) does not -- a translated paragraph always comes back as a
// plain <p>. Good enough for "I can read what this card says", not meant
// to preserve the original's styling.

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// A card title is edited in RichTextEditor's `minimal` mode (bold/color,
// no block tags), so it collapses to a single plain-text run.
function htmlToPlainInline(html: string): string {
  if (typeof document === "undefined") return html.replace(/<[^>]+>/g, "").trim();
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || "").replace(/\s+/g, " ").trim();
}

function plainToInlineHtml(text: string): string {
  return escapeHtml(text.trim());
}

// A description/comment can have paragraphs, headings and list items --
// each becomes its own plain-text "paragraph" so translation keeps them
// separate instead of running everything together.
function htmlToParagraphs(html: string): string[] {
  if (typeof document === "undefined") return [];
  const div = document.createElement("div");
  div.innerHTML = html;
  const paras: string[] = [];
  function pushText(el: Element) {
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (text) paras.push(text);
  }
  const blockTags = new Set(["P", "H2", "H3"]);
  let sawBlock = false;
  for (const child of Array.from(div.children)) {
    if (child.tagName === "UL" || child.tagName === "OL") {
      for (const li of Array.from(child.children)) {
        if (li.tagName === "LI") {
          pushText(li);
          sawBlock = true;
        }
      }
    } else if (blockTags.has(child.tagName)) {
      pushText(child);
      sawBlock = true;
    }
  }
  if (!sawBlock) {
    const text = (div.textContent || "").replace(/\s+/g, " ").trim();
    if (text) paras.push(text);
  }
  return paras;
}

function paragraphsToHtml(paras: string[]): string {
  return paras
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");
}

// The label pill on a card shows this card's own cached translation of its
// label's name (not a project-wide rename -- other cards using the same
// label keep showing the original). Label names are treated as authored in
// French (this app's default), so there's nothing to translate for an "fr"
// card.
function displayLabelName(card: Pick<Card, "lang" | "translations" | "labelId">, label: Label | undefined): string | undefined {
  if (!label) return undefined;
  const lang = card.lang ?? "fr";
  if (lang !== "fr") {
    const cache = card.translations?.[lang];
    if (cache && cache.labelId === card.labelId && cache.labelName) return cache.labelName;
  }
  return label.name;
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
type Me = { username: string; role: "admin" | "manager" | "member"; avatarUrl?: string };

// Just enough of PublicUser (src/lib/auth.ts) for the participants panel --
// fetched from GET /api/users, readable by admin and manager alike.
type PublicUserLite = {
  id: string;
  username: string;
  role: "admin" | "manager" | "member";
  projectIds?: string[];
};

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
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [moveMenuColId, setMoveMenuColId] = useState<string>("");
  const [langSwitching, setLangSwitching] = useState(false);
  const [langError, setLangError] = useState("");
  const [espaceOpen, setEspaceOpen] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [collapsedCommentIds, setCollapsedCommentIds] = useState<Set<string>>(new Set());
  const [projectLogoBusy, setProjectLogoBusy] = useState(false);
  const [projectLogoError, setProjectLogoError] = useState("");
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [allUsers, setAllUsers] = useState<PublicUserLite[] | null>(null);
  const [participantsBusyId, setParticipantsBusyId] = useState<string | null>(null);
  const [participantsError, setParticipantsError] = useState("");
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileUsername, setProfileUsername] = useState("");
  const [profileCurrentPassword, setProfileCurrentPassword] = useState("");
  const [profileNewPassword, setProfileNewPassword] = useState("");
  const [profileConfirmPassword, setProfileConfirmPassword] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const moveMenuRef = useRef<HTMLDivElement | null>(null);
  const espaceRef = useRef<HTMLDivElement | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const projectLogoFileInputRef = useRef<HTMLInputElement | null>(null);
  const participantsRef = useRef<HTMLDivElement | null>(null);

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

  // Same pattern for the "Déplacer vers…" panel.
  useEffect(() => {
    if (!moveMenuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!moveMenuRef.current?.contains(e.target as Node)) {
        setMoveMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [moveMenuOpen]);

  // Same pattern for "Mon espace".
  useEffect(() => {
    if (!espaceOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!espaceRef.current?.contains(e.target as Node)) setEspaceOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [espaceOpen]);

  // However it closes (outside click, toggling it shut), don't leave the
  // profile form silently open for next time.
  useEffect(() => {
    if (!espaceOpen) setProfileEditing(false);
  }, [espaceOpen]);

  // Same pattern for the participants panel, plus a lazy fetch of the user
  // list the first time it's opened (admin/manager only, see GET
  // /api/users).
  useEffect(() => {
    if (!participantsOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!participantsRef.current?.contains(e.target as Node)) setParticipantsOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    if (allUsers === null) {
      fetch("/api/users")
        .then((r) => (r.ok ? r.json() : []))
        .then(setAllUsers)
        .catch(() => setAllUsers([]));
    }
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [participantsOpen, allUsers]);

  // Clicking "Répondre" jumps straight to the reply field, like an HTML
  // anchor -- no manual scrolling to find it, especially useful once the
  // deeper replies around it have collapsed out of view.
  useEffect(() => {
    if (composer?.mode !== "reply") return;
    document.getElementById("reply-composer-box")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [composer?.mode, composer?.targetId]);

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

  // Avatar upload reuses the same /api/upload endpoint as attachments, then
  // stamps the resulting URL onto the session's own user record -- always
  // the caller's own account, PATCH /api/auth/me never takes a userId.
  async function handleAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setAvatarError("Choisis une image.");
      return;
    }
    setAvatarError("");
    setAvatarBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: form });
      const uploadJson = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadJson.error || "Échec de l'envoi.");
      const patchRes = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: uploadJson.url }),
      });
      if (!patchRes.ok) throw new Error("Échec de la mise à jour du profil.");
      setMe((prev) => (prev ? { ...prev, avatarUrl: uploadJson.url } : prev));
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "Échec de l'envoi.");
    } finally {
      setAvatarBusy(false);
    }
  }

  // Same upload endpoint as avatars/attachments. Only shown to admin/manager
  // (see canManage) -- the server independently reverts any logo change
  // from anyone else, this is just what lets the button show at all.
  async function handleProjectLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !activeProjectId) return;
    if (!file.type.startsWith("image/")) {
      setProjectLogoError("Choisis une image.");
      return;
    }
    setProjectLogoError("");
    setProjectLogoBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Échec de l'envoi.");
      updateBoard((b) => {
        const project = b.projects.find((p) => p.id === activeProjectId);
        if (project) project.logoUrl = json.url;
      });
    } catch (err) {
      setProjectLogoError(err instanceof Error ? err.message : "Échec de l'envoi.");
    } finally {
      setProjectLogoBusy(false);
    }
  }

  async function removeAvatar() {
    setAvatarError("");
    setAvatarBusy(true);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: null }),
      });
      if (!res.ok) throw new Error("Échec de la mise à jour du profil.");
      setMe((prev) => (prev ? { ...prev, avatarUrl: undefined } : prev));
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "Échec de la mise à jour du profil.");
    } finally {
      setAvatarBusy(false);
    }
  }

  function startEditProfile() {
    setProfileUsername(me?.username ?? "");
    setProfileCurrentPassword("");
    setProfileNewPassword("");
    setProfileConfirmPassword("");
    setProfileError("");
    setProfileEditing(true);
  }

  // Self-service: everyone can rename themselves and/or change their
  // password (never their role, that's admin-only via /users). Password
  // changes are only sent if a new one was actually typed, and the two
  // "new password" fields must match before this even calls the API.
  async function submitProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileError("");
    const changingPassword = profileNewPassword.trim().length > 0;
    if (changingPassword && profileNewPassword !== profileConfirmPassword) {
      setProfileError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    if (changingPassword && !profileCurrentPassword) {
      setProfileError("Ton mot de passe actuel est requis pour le changer.");
      return;
    }
    const body: { username?: string; newPassword?: string; currentPassword?: string } = {};
    if (profileUsername.trim() && profileUsername.trim() !== me?.username) body.username = profileUsername.trim();
    if (changingPassword) {
      body.newPassword = profileNewPassword;
      body.currentPassword = profileCurrentPassword;
    }
    if (!body.username && !body.newPassword) {
      setProfileEditing(false);
      return;
    }
    setProfileBusy(true);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Échec de la mise à jour du profil.");
      setMe((prev) => (prev ? { ...prev, username: json.username } : prev));
      setProfileEditing(false);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Échec de la mise à jour du profil.");
    } finally {
      setProfileBusy(false);
    }
  }

  const visibleProjects = board?.projects.filter((p) => !p.archived) ?? [];
  const archivedProjects = board?.projects.filter((p) => p.archived) ?? [];
  const activeProject = visibleProjects.find((p) => p.id === activeProjectId);
  // Mirrors canManage() server-side (src/app/api/board/route.ts): admin and
  // manager can archive projects, moderate any comment, and add
  // participants. This is only a UI convenience -- the server enforces it
  // regardless of what the client sends.
  const canManage = me?.role === "admin" || me?.role === "manager";

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

  // A user can see this project if they're admin, unrestricted (projectIds
  // undefined -- the default), or this project id is explicitly on their
  // list. Mirrors visibleProjectIds in src/app/api/board/route.ts.
  function hasProjectAccess(u: PublicUserLite, projectId: string): boolean {
    return u.role === "admin" || u.projectIds === undefined || u.projectIds.includes(projectId);
  }

  function grantParticipant(userId: string) {
    if (!activeProjectId) return;
    setParticipantsError("");
    setParticipantsBusyId(userId);
    fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grantProjectId: activeProjectId }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Échec de l'ajout.");
        setAllUsers((prev) => prev?.map((u) => (u.id === userId ? json : u)) ?? prev);
      })
      .catch((err) => setParticipantsError(err instanceof Error ? err.message : "Échec de l'ajout."))
      .finally(() => setParticipantsBusyId(null));
  }

  // Who already sees this project ("Ont déjà accès", read-only here -- only
  // admin can revoke, from the full picker on /users) vs who a manager or
  // admin can grant it to with one click ("Ajouter").
  function renderParticipantsPanel() {
    if (!activeProjectId) return null;
    const users = allUsers ?? [];
    const withAccess = users.filter((u) => hasProjectAccess(u, activeProjectId));
    const candidates = users.filter((u) => !hasProjectAccess(u, activeProjectId));
    return (
      <div className="participants-panel">
        <div className="participants-panel-head">Ont déjà accès</div>
        {allUsers === null ? (
          <p className="participants-empty">Chargement…</p>
        ) : withAccess.length === 0 ? (
          <p className="participants-empty">Personne pour l'instant.</p>
        ) : (
          <div className="participants-list">
            {withAccess.map((u) => (
              <span className="participant-row" key={u.id}>
                {u.username}
                {u.role !== "member" && (
                  <span className="participant-role">{u.role === "admin" ? "admin" : "manager"}</span>
                )}
              </span>
            ))}
          </div>
        )}
        {candidates.length > 0 && (
          <>
            <div className="participants-panel-head participants-panel-add">Ajouter</div>
            <div className="participants-list">
              {candidates.map((u) => (
                <button
                  type="button"
                  className="participant-add-row"
                  key={u.id}
                  disabled={participantsBusyId === u.id}
                  onClick={() => grantParticipant(u.id)}
                >
                  <span>{u.username}</span>
                  <span className="participant-add-icon">{participantsBusyId === u.id ? "…" : "+"}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {participantsError && <p className="cd-error">{participantsError}</p>}
      </div>
    );
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
    setMoveMenuOpen(false);
    setMoveMenuColId(colId);
    setLangSwitching(false);
    setLangError("");
    setCollapsedCommentIds(new Set());
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

  // Clicking FR/EN translates the card's title, description, label name
  // (for this card's own display) and comments to that language, and
  // commits straight away -- like labels/comments, not gated behind
  // "Enregistrer". The language being left is cached (per card, per
  // comment) so switching back is instant and doesn't re-translate through
  // another machine-translation round-trip.
  async function switchCardLanguage(targetLang: CardLang) {
    if (!selected || !liveCard || langSwitching) return;
    const sourceLang: CardLang = liveCard.lang ?? "fr";
    if (targetLang === sourceLang) return;
    setLangError("");
    // Title/description live in the draft until "Enregistrer" -- translating
    // now would either translate a stale (already-saved) version and orphan
    // the pending edit, or silently discard it. Simplest safe rule: save
    // first.
    if (dirty) {
      setLangError("Enregistre d'abord tes modifications avant de changer de langue.");
      return;
    }

    const label = findLabel(liveCard.labelId);
    const currentLabelName = displayLabelName(liveCard, label);

    const targetCache = liveCard.translations?.[targetLang];
    const targetCacheValid = !!targetCache && (!label || targetCache.labelId === liveCard.labelId);
    const needTitleDesc = !targetCacheValid;
    const needLabel = needTitleDesc && !!label;
    const commentsNeeding = liveCard.comments.filter((c) => !c.translations?.[targetLang]);

    let newTitle = targetCacheValid ? targetCache!.title : undefined;
    let newDescription = targetCacheValid ? targetCache!.description : undefined;
    let newLabelName = targetCacheValid ? targetCache!.labelName : undefined;
    const newCommentHtml = new Map<string, string>();
    for (const c of liveCard.comments) {
      const cached = c.translations?.[targetLang];
      if (cached !== undefined) newCommentHtml.set(c.id, cached);
    }

    if (needTitleDesc || needLabel || commentsNeeding.length > 0) {
      type Job =
        | { kind: "title" }
        | { kind: "description"; paraCount: number }
        | { kind: "label" }
        | { kind: "comment"; commentId: string; paraCount: number };
      const jobs: Job[] = [];
      const texts: string[] = [];

      if (needTitleDesc) {
        jobs.push({ kind: "title" });
        texts.push(htmlToPlainInline(liveCard.title));
        const descParas = htmlToParagraphs(liveCard.description || "");
        jobs.push({ kind: "description", paraCount: descParas.length });
        texts.push(...descParas);
      }
      if (needLabel) {
        jobs.push({ kind: "label" });
        texts.push(currentLabelName || label!.name);
      }
      for (const c of commentsNeeding) {
        const paras = htmlToParagraphs(c.html);
        jobs.push({ kind: "comment", commentId: c.id, paraCount: paras.length });
        texts.push(...paras);
      }

      setLangSwitching(true);
      try {
        let translated: string[] = [];
        if (texts.length > 0) {
          const res = await fetch("/api/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ texts, from: sourceLang, to: targetLang }),
          });
          const json = await res.json();
          if (!res.ok || !Array.isArray(json.translations)) {
            throw new Error(json?.error || "Échec de la traduction.");
          }
          translated = json.translations;
        }

        let cursor = 0;
        for (const job of jobs) {
          if (job.kind === "title") {
            newTitle = plainToInlineHtml(translated[cursor] ?? "");
            cursor += 1;
          } else if (job.kind === "description") {
            newDescription = paragraphsToHtml(translated.slice(cursor, cursor + job.paraCount));
            cursor += job.paraCount;
          } else if (job.kind === "label") {
            newLabelName = (translated[cursor] ?? "").trim().slice(0, 24) || label!.name;
            cursor += 1;
          } else {
            newCommentHtml.set(job.commentId, paragraphsToHtml(translated.slice(cursor, cursor + job.paraCount)));
            cursor += job.paraCount;
          }
        }
      } catch (err) {
        setLangError(err instanceof Error ? err.message : "Échec de la traduction.");
        setLangSwitching(false);
        return;
      }
      setLangSwitching(false);
    }

    // Built once and applied identically to both the live board and the
    // open draft below, so the label-trigger button (reads the draft) and
    // the card face (reads the live board) never disagree about which
    // translated label name is current.
    const translationsPatch: NonNullable<Card["translations"]> = {
      [sourceLang]: {
        title: liveCard.title,
        description: liveCard.description ?? "",
        labelId: liveCard.labelId,
        labelName: currentLabelName,
      },
    };
    if (newLabelName !== undefined) {
      translationsPatch[targetLang] = {
        ...(liveCard.translations?.[targetLang] ?? { title: "", description: "" }),
        labelId: liveCard.labelId,
        labelName: newLabelName,
      };
    }

    updateBoard((b) => {
      const project = b.projects.find((p) => p.id === selected.projectId);
      const col = project?.columns.find((c) => c.id === selected.colId);
      const card = col?.cards.find((c) => c.id === selected.cardId);
      if (!card) return;
      card.translations = { ...card.translations, ...translationsPatch };
      if (newTitle !== undefined) card.title = newTitle;
      if (newDescription !== undefined) card.description = newDescription;
      card.lang = targetLang;
      for (const c of card.comments) {
        const nc = newCommentHtml.get(c.id);
        if (nc !== undefined) {
          if (!c.translations) c.translations = {};
          c.translations[sourceLang] = c.html;
          c.html = nc;
        }
      }
    });

    // The draft mirrors title/description/translations while the card is
    // open; safe to sync it here since we just refused to run with unsaved
    // changes.
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            title: newTitle ?? prev.title,
            description: newDescription ?? prev.description,
            lang: targetLang,
            translations: { ...prev.translations, ...translationsPatch },
          }
        : prev
    );
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

  // How deep a comment sits in its reply chain -- 0 for a top-level
  // comment. Bounded by `seen` in case bad data ever formed a cycle
  // upstream (the API already guards against that, this is just defensive).
  function depthOf(commentId: string): number {
    let depth = 0;
    let current = allComments.find((c) => c.id === commentId);
    const seen = new Set<string>();
    while (current?.parentId && !seen.has(current.id)) {
      seen.add(current.id);
      depth++;
      current = allComments.find((c) => c.id === current!.parentId);
    }
    return depth;
  }

  // While actively replying to one comment, anything nested deeper than it
  // hides temporarily (see .comment.collapsed) so the thread doesn't bury
  // the field you're typing into under its own old sub-replies. Comments at
  // the same depth (siblings of the one being replied to) stay visible.
  const replyFocusDepth = composer?.mode === "reply" ? depthOf(composer.targetId) : null;
  const hiddenByFocusCount =
    replyFocusDepth === null ? 0 : allComments.filter((c) => depthOf(c.id) > replyFocusDepth).length;

  function findLabel(labelId: string | undefined): Label | undefined {
    return activeProject?.labels?.find((l) => l.id === labelId);
  }

  // "Déplacer vers…" -- a keyboard/mobile-friendly fallback to drag-and-drop
  // for repositioning a card (drag-and-drop barely works on touch, and has
  // no keyboard equivalent). Deliberately simpler than the drag gestures:
  // pick a column, then either "carte de premier niveau" or an existing
  // card to nest under (always appended as its last child) -- no
  // before/after sibling precision here, that stays a drag-only nicety.
  function candidateParents(colId: string): { card: Card; depth: number }[] {
    if (!selected || !activeProject) return [];
    const col = activeProject.columns.find((c) => c.id === colId);
    if (!col) return [];
    // Can't nest a card under itself or one of its own descendants.
    const excluded = collectSubtreeIds(activeProject, selected.cardId);
    const result: { card: Card; depth: number }[] = [];
    function walk(parentId: string | undefined, depth: number) {
      col!.cards
        .filter((c) => c.parentId === parentId && !excluded.has(c.id))
        .forEach((c) => {
          result.push({ card: c, depth });
          walk(c.id, depth + 1);
        });
    }
    walk(undefined, 0);
    return result;
  }

  function handleMove(colId: string, refCardId: string | null) {
    if (!selected) return;
    const target: NonNullable<DropTarget> = refCardId
      ? { colId, mode: "nest", refCardId }
      : { colId, mode: "end", refCardId: null };
    moveSubtree(selected.cardId, selected.colId, target);
    setSelected((prev) => (prev ? { ...prev, colId } : prev));
    setMoveMenuOpen(false);
  }

  function repliesOf(commentId: string): Comment[] {
    return allComments.filter((c) => c.parentId === commentId);
  }

  // A comment plus every reply nested under it, any depth -- same
  // fixed-point walk as collectSubtreeIds uses for cards.
  function collectCommentSubtreeIds(rootId: string): Set<string> {
    const result = new Set<string>([rootId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of allComments) {
        if (c.parentId && result.has(c.parentId) && !result.has(c.id)) {
          result.add(c.id);
          changed = true;
        }
      }
    }
    return result;
  }

  function subtreeReplyCount(commentId: string): number {
    return collectCommentSubtreeIds(commentId).size - 1;
  }

  // True if some ancestor of this comment was manually collapsed via its
  // own +/- toggle -- distinct from replyFocusDepth's temporary hide while
  // composing a reply (see renderComment).
  function hasCollapsedAncestor(commentId: string): boolean {
    let current = allComments.find((c) => c.id === commentId);
    while (current?.parentId) {
      if (collapsedCommentIds.has(current.parentId)) return true;
      current = allComments.find((c) => c.id === current!.parentId);
    }
    return false;
  }

  function toggleCommentCollapsed(commentId: string) {
    setCollapsedCommentIds((prev) => {
      const next = new Set(prev);
      if (next.has(commentId)) next.delete(commentId);
      else next.add(commentId);
      return next;
    });
  }

  // Deleting always takes the whole reply subtree with it (see the
  // conversation this shipped from) -- authorized if you wrote the comment,
  // or if you can moderate this project (canManage). The server re-checks
  // this independently; this is just what lets the button show at all.
  function deleteComment(commentId: string) {
    if (!selected) return;
    const idsToDelete = collectCommentSubtreeIds(commentId);
    const label =
      idsToDelete.size > 1
        ? "Supprimer ce commentaire ? Ses réponses seront supprimées aussi."
        : "Supprimer ce commentaire ?";
    if (!window.confirm(label)) return;
    updateBoard((b) => {
      const project = b.projects.find((p) => p.id === selected.projectId);
      const col = project?.columns.find((c) => c.id === selected.colId);
      const card = col?.cards.find((c) => c.id === selected.cardId);
      if (!card) return;
      card.comments = card.comments.filter((c) => !idsToDelete.has(c.id));
    });
    if (composer && idsToDelete.has(composer.targetId)) setComposer(null);
  }

  function renderComposerBox(saveLabel: string) {
    if (!composer) return null;
    return (
      <div className="mini-editor">
        <RichTextEditor
          key={composer.key}
          value={composer.html}
          placeholder={composer.mode === "reply" ? "Répondre…" : "Modifier le commentaire…"}
          lang={liveCard?.lang ?? "fr"}
          onSave={(html) => setComposer((prev) => (prev ? { ...prev, html } : prev))}
          onChange={(html) => setComposer((prev) => (prev ? { ...prev, html } : prev))}
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

  function renderComment(c: Comment, depth: number): React.ReactNode {
    const mine = me?.username === c.authorUsername;
    const canDelete = mine || canManage;
    const isEditingThis = composer?.mode === "edit" && composer.targetId === c.id;
    const isReplyingHere = composer?.mode === "reply" && composer.targetId === c.id;
    const replies = repliesOf(c.id);
    const focusHidden = replyFocusDepth !== null && depth > replyFocusDepth;
    const manuallyHidden = hasCollapsedAncestor(c.id);
    const isCollapsedByUser = collapsedCommentIds.has(c.id);
    return (
      <div
        className={"comment" + (focusHidden || manuallyHidden ? " collapsed" : "")}
        style={{ "--av": avatarColor(c.authorUsername) } as React.CSSProperties}
        key={c.id}
      >
        <div className="comment-head">
          {replies.length > 0 && (
            <button
              type="button"
              className="comment-collapse-btn"
              title={isCollapsedByUser ? "Déplier les réponses" : "Réduire les réponses"}
              onClick={() => toggleCommentCollapsed(c.id)}
            >
              {isCollapsedByUser ? "+" : "−"}
            </button>
          )}
          <div className="avatar">{initials(c.authorUsername)}</div>
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
            {isCollapsedByUser && replies.length > 0 && (
              <p className="mask-note">
                {subtreeReplyCount(c.id)} réponse{subtreeReplyCount(c.id) > 1 ? "s" : ""} repliée
                {subtreeReplyCount(c.id) > 1 ? "s" : ""}
              </p>
            )}
            <div className="c-actions">
              <button
                type="button"
                className="c-action-btn"
                onClick={() => (isReplyingHere ? cancelComposer() : startReply(c.id))}
              >
                ↩ Répondre
              </button>
              {mine && (
                <button type="button" className="c-action-btn" onClick={() => startEditComment(c)}>
                  ✏️ Modifier
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  className="c-action-btn c-action-danger"
                  onClick={() => deleteComment(c.id)}
                >
                  🗑 Supprimer
                </button>
              )}
            </div>
          </>
        )}

        {isReplyingHere && (
          <div className="c-replies reply-composer" id="reply-composer-box">
            {renderComposerBox("Publier la réponse")}
            {hiddenByFocusCount > 0 && (
              <p className="mask-note">
                {hiddenByFocusCount} réponse{hiddenByFocusCount > 1 ? "s" : ""} plus profonde
                {hiddenByFocusCount > 1 ? "s" : ""} masquée{hiddenByFocusCount > 1 ? "s" : ""} pendant la rédaction —{" "}
                <button type="button" className="mask-note-btn" onClick={cancelComposer}>
                  tout afficher
                </button>
              </p>
            )}
          </div>
        )}

        {replies.length > 0 && (
          <div className="c-replies">{replies.map((r) => renderComment(r, depth + 1))}</div>
        )}
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
              {displayLabelName(card, label)}
            </span>
          )}
          <span
            className="title"
            style={card.titleColor ? { color: card.titleColor } : undefined}
            dangerouslySetInnerHTML={{ __html: card.title }}
          />
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
          <img src="/logo-icon.png" alt="" className="wm-icon" />
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
                {p.logoUrl && <img src={p.logoUrl} alt="" className="tab-logo" />}
                {p.name}
              </button>
              {p.id === activeProjectId && canManage && (
                <button
                  type="button"
                  className="tab-logo-edit"
                  disabled={projectLogoBusy}
                  title={p.logoUrl ? "Changer le logo du projet" : "Ajouter un logo au projet"}
                  onClick={() => projectLogoFileInputRef.current?.click()}
                >
                  {projectLogoBusy ? "…" : "🖼"}
                </button>
              )}
              {p.id === activeProjectId && canManage && (
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
          <input
            ref={projectLogoFileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={handleProjectLogoFile}
          />
        </div>
        {canManage && activeProject && (
          <div className="participants-wrap" ref={participantsRef}>
            <button
              type="button"
              className="trash-open"
              onClick={() => setParticipantsOpen((v) => !v)}
            >
              👥 Participants
            </button>
            {participantsOpen && renderParticipantsPanel()}
          </div>
        )}
        <button type="button" className="trash-open" onClick={() => setTrashOpen(true)}>
          🗑 Corbeille {archivedProjects.length > 0 ? `(${archivedProjects.length})` : ""}
        </button>
        {projectLogoError && <span className="cd-error">{projectLogoError}</span>}
        {me && (
          <div className="user-badge">
            <div className="espace-wrap" ref={espaceRef}>
              <button
                type="button"
                className="espace-avatar"
                style={!me.avatarUrl ? ({ "--av": avatarColor(me.username) } as React.CSSProperties) : undefined}
                onClick={() => setEspaceOpen((v) => !v)}
                aria-label="Mon espace"
              >
                {me.avatarUrl ? <img src={me.avatarUrl} alt="" /> : initials(me.username)}
              </button>
              {espaceOpen && (
                <div className="espace-panel">
                  <button
                    type="button"
                    className="espace-panel-avatar"
                    onClick={() => avatarFileInputRef.current?.click()}
                    aria-label={me.avatarUrl ? "Changer la photo" : "Ajouter une photo"}
                  >
                    {me.avatarUrl ? (
                      <img src={me.avatarUrl} alt="" />
                    ) : (
                      <span style={{ "--av": avatarColor(me.username) } as React.CSSProperties}>
                        {initials(me.username)}
                      </span>
                    )}
                    <span className="espace-panel-avatar-overlay">
                      {avatarBusy ? "…" : me.avatarUrl ? "Changer" : "Ajouter"}
                    </span>
                  </button>
                  <div className="espace-panel-name">{me.username}</div>
                  <div className="espace-panel-role">{roleLabel(me.role)}</div>
                  <div className="espace-panel-actions">
                    <button
                      type="button"
                      className="tab"
                      disabled={avatarBusy}
                      onClick={() => avatarFileInputRef.current?.click()}
                    >
                      {avatarBusy ? "Envoi…" : me.avatarUrl ? "Changer la photo" : "Ajouter une photo"}
                    </button>
                    {me.avatarUrl && (
                      <button type="button" className="tab" disabled={avatarBusy} onClick={removeAvatar}>
                        Retirer
                      </button>
                    )}
                  </div>
                  {avatarError && <p className="cd-error">{avatarError}</p>}
                  <input
                    ref={avatarFileInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={handleAvatarFile}
                  />

                  <div className="espace-sep" />

                  {profileEditing ? (
                    <form className="profile-form" onSubmit={submitProfile}>
                      <label className="field">
                        <span>Identifiant</span>
                        <input value={profileUsername} onChange={(e) => setProfileUsername(e.target.value)} />
                      </label>
                      <label className="field">
                        <span>Mot de passe actuel</span>
                        <input
                          type="password"
                          value={profileCurrentPassword}
                          onChange={(e) => setProfileCurrentPassword(e.target.value)}
                          placeholder="pour changer le mot de passe"
                        />
                      </label>
                      <label className="field">
                        <span>Nouveau mot de passe</span>
                        <input
                          type="password"
                          value={profileNewPassword}
                          onChange={(e) => setProfileNewPassword(e.target.value)}
                          minLength={8}
                        />
                      </label>
                      <label className="field">
                        <span>Confirmer</span>
                        <input
                          type="password"
                          value={profileConfirmPassword}
                          onChange={(e) => setProfileConfirmPassword(e.target.value)}
                          minLength={8}
                        />
                      </label>
                      <div className="espace-panel-actions">
                        <button
                          type="button"
                          className="tab"
                          disabled={profileBusy}
                          onClick={() => setProfileEditing(false)}
                        >
                          Annuler
                        </button>
                        <button type="submit" className="tab" disabled={profileBusy}>
                          {profileBusy ? "…" : "Enregistrer"}
                        </button>
                      </div>
                      {profileError && <p className="cd-error">{profileError}</p>}
                    </form>
                  ) : (
                    <button type="button" className="tab" onClick={startEditProfile}>
                      ✏️ Modifier le profil
                    </button>
                  )}
                </div>
              )}
            </div>
            <span>{me.username}</span>
            {(me.role === "admin" || me.role === "manager") && (
              <Link className="tab" href="/prospection">
                Prospection
              </Link>
            )}
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

      {activeProject && (
        <div className="project-banner">
          {activeProject.logoUrl && <img src={activeProject.logoUrl} alt="" className="project-banner-logo" />}
          <span className="project-banner-name">{activeProject.name}</span>
        </div>
      )}

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
                    <div className="cd-title-input" style={draft.titleColor ? { color: draft.titleColor } : undefined}>
                      <RichTextEditor
                        key={draft.id}
                        value={draft.title}
                        minimal
                        placeholder="Titre de la carte…"
                        lang={draft.lang ?? "fr"}
                        onSave={(html) => {
                          updateDraft((c) => {
                            c.title = html;
                          });
                        }}
                        onChange={() => {
                          setDirty(true);
                          setSavedFlash(false);
                        }}
                        onEnterKey={() => setTitleEditing(false)}
                      />
                    </div>
                  ) : (
                    <span
                      className="cd-title-view"
                      style={draft.titleColor ? { color: draft.titleColor } : undefined}
                      dangerouslySetInnerHTML={{ __html: draft.title }}
                    />
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
                      <span>{draftLabel ? displayLabelName(draft, draftLabel) : "Sans étiquette"}</span>
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
                  <div className="lang-toggle" title="Traduire cette carte (titre, description, commentaires)">
                    <button
                      type="button"
                      className={"lang-btn" + ((draft.lang ?? "fr") === "fr" ? " active" : "")}
                      disabled={langSwitching}
                      onClick={() => switchCardLanguage("fr")}
                    >
                      FR
                    </button>
                    <button
                      type="button"
                      className={"lang-btn" + (draft.lang === "en" ? " active" : "")}
                      disabled={langSwitching}
                      onClick={() => switchCardLanguage("en")}
                    >
                      EN
                    </button>
                  </div>
                  {langSwitching && <span className="lang-status">Traduction…</span>}
                </div>

                {langError && <p className="cd-error">{langError}</p>}

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
                    lang={draft.lang ?? "fr"}
                    onSave={(html) => {
                      updateDraft((c) => {
                        c.description = html;
                      });
                    }}
                    onChange={() => {
                      setDirty(true);
                      setSavedFlash(false);
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
                            <RichTextEditor
                              key={a.id}
                              value={a.note ?? ""}
                              placeholder="Petite note sur cette image…"
                              lang={draft.lang ?? "fr"}
                              onSave={(html) => updateAttachmentNote(a.id, html)}
                              onChange={() => {
                                setDirty(true);
                                setSavedFlash(false);
                              }}
                            />
                          ) : (
                            <ClampBlock
                              html={a.note || ""}
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
                              {displayLabelName(s, sLabel)}
                            </span>
                          )}
                          <span dangerouslySetInnerHTML={{ __html: s.title }} />
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
                  <div className="comment-list">{topComments.map((c) => renderComment(c, 0))}</div>
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
                    lang={draft.lang ?? "fr"}
                    onSave={setNewCommentHtml}
                    onChange={setNewCommentHtml}
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

              <div className="move-wrap" ref={moveMenuRef}>
                <button
                  type="button"
                  className={"move-trigger" + (moveMenuOpen ? " open" : "")}
                  onClick={() => setMoveMenuOpen((v) => !v)}
                >
                  ↔ Déplacer…
                </button>
                {moveMenuOpen && (
                  <div className="move-panel">
                    <div className="move-panel-head">Déplacer vers</div>
                    <div className="move-col-tabs">
                      {activeProject?.columns.map((col) => (
                        <button
                          key={col.id}
                          type="button"
                          className={"move-col-tab" + (moveMenuColId === col.id ? " active" : "")}
                          onClick={() => setMoveMenuColId(col.id)}
                        >
                          {col.name}
                        </button>
                      ))}
                    </div>
                    <div className="move-list">
                      <button
                        type="button"
                        className="move-row"
                        onClick={() => handleMove(moveMenuColId, null)}
                      >
                        <span className="move-row-icon">⇤</span>
                        <span>Carte de premier niveau</span>
                      </button>
                      {candidateParents(moveMenuColId).map(({ card, depth }) => (
                        <button
                          key={card.id}
                          type="button"
                          className="move-row"
                          style={{ paddingLeft: 12 + depth * 16 }}
                          onClick={() => handleMove(moveMenuColId, card.id)}
                        >
                          <span className="move-row-icon">↳</span>
                          <span className="move-row-title" dangerouslySetInnerHTML={{ __html: card.title }} />
                        </button>
                      ))}
                      {candidateParents(moveMenuColId).length === 0 && (
                        <p className="move-empty">Aucune autre carte dans cette colonne.</p>
                      )}
                    </div>
                  </div>
                )}
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
