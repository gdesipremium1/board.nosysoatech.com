"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { BoardData, Card, Column } from "@/lib/store";
import RichTextEditor from "@/components/RichTextEditor";
import { PRESET_COLORS } from "@/lib/colors";

const TAG_LABELS: Record<Card["tag"], string> = {
  front: "front",
  backend: "backend",
  bug: "bug",
  content: "contenu",
  other: "autre",
};

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

type Selected = { projectId: string; colId: string; cardId: string };
type Me = { username: string; role: "admin" | "member" };

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
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [trashOpen, setTrashOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const dragData = useRef<{ cardId: string; fromColId: string } | null>(null);
  const colRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
      col?.cards.push({ id: newId(), title, tag: "other", attachments: [] });
    });
    setDraftTitle("");
    setAddingInCol(null);
  }

  function moveCard(cardId: string, fromColId: string, toColId: string, toIndex: number) {
    if (!activeProjectId) return;
    updateBoard((b) => {
      const project = b.projects.find((p) => p.id === activeProjectId);
      if (!project) return;
      const fromCol = project.columns.find((c) => c.id === fromColId);
      const toCol = project.columns.find((c) => c.id === toColId);
      if (!fromCol || !toCol) return;
      const idx = fromCol.cards.findIndex((c) => c.id === cardId);
      if (idx === -1) return;
      const [card] = fromCol.cards.splice(idx, 1);
      let insertAt = toIndex;
      if (fromCol === toCol && idx < toIndex) insertAt -= 1;
      toCol.cards.splice(insertAt, 0, card);
    });
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>, colId: string) {
    e.preventDefault();
    setDragoverCol(null);
    const data = dragData.current;
    if (!data) return;
    const container = colRefs.current[colId];
    let targetIndex = 0;
    if (container) {
      const cardEls = Array.from(container.querySelectorAll<HTMLElement>("[data-card-id]"));
      targetIndex = cardEls.length;
      for (let i = 0; i < cardEls.length; i++) {
        const rect = cardEls[i].getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
          targetIndex = i;
          break;
        }
      }
    }
    moveCard(data.cardId, data.fromColId, colId, targetIndex);
    dragData.current = null;
  }

  function openCard(colId: string, card: Card) {
    if (!activeProjectId) return;
    setUploadError("");
    setSelected({ projectId: activeProjectId, colId, cardId: card.id });
  }

  function closeCard() {
    dialogRef.current?.close();
    setSelected(null);
  }

  function getSelectedCard(): Card | null {
    if (!selected || !board) return null;
    const project = board.projects.find((p) => p.id === selected.projectId);
    const col = project?.columns.find((c) => c.id === selected.colId);
    return col?.cards.find((c) => c.id === selected.cardId) ?? null;
  }

  function updateSelectedCard(mutator: (c: Card) => void) {
    if (!selected) return;
    updateBoard((b) => {
      const project = b.projects.find((p) => p.id === selected.projectId);
      const col = project?.columns.find((c) => c.id === selected.colId);
      const card = col?.cards.find((c) => c.id === selected.cardId);
      if (card) mutator(card);
    });
  }

  function deleteCard() {
    if (!selected) return;
    if (!window.confirm("Supprimer cette carte ?")) return;
    updateBoard((b) => {
      const project = b.projects.find((p) => p.id === selected.projectId);
      const col = project?.columns.find((c) => c.id === selected.colId);
      if (!col) return;
      col.cards = col.cards.filter((c) => c.id !== selected.cardId);
    });
    closeCard();
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
      updateSelectedCard((card) => {
        card.attachments.push(json);
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Échec de l'envoi.");
    } finally {
      setUploadBusy(false);
    }
  }

  function removeAttachment(attachmentId: string) {
    updateSelectedCard((card) => {
      card.attachments = card.attachments.filter((a) => a.id !== attachmentId);
    });
  }

  function updateAttachmentNote(attachmentId: string, note: string) {
    updateSelectedCard((card) => {
      const att = card.attachments.find((a) => a.id === attachmentId);
      if (att) att.note = note;
    });
  }

  if (loading) {
    return <p style={{ padding: 22, fontFamily: "var(--font-mono)" }}>Chargement…</p>;
  }
  if (!board) {
    return <p style={{ padding: 22 }}>Impossible de charger le tableau.</p>;
  }

  const selectedCard = getSelectedCard();

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
              <span className="count">{col.cards.length}</span>
            </div>
            <div
              className={"col-body" + (dragoverCol === col.id ? " dragover" : "")}
              ref={(el) => {
                colRefs.current[col.id] = el;
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragoverCol(col.id);
              }}
              onDragLeave={() => setDragoverCol((c) => (c === col.id ? null : c))}
              onDrop={(e) => handleDrop(e, col.id)}
            >
              {col.cards.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  className="card"
                  data-card-id={card.id}
                  draggable
                  onDragStart={() => {
                    dragData.current = { cardId: card.id, fromColId: col.id };
                  }}
                  onClick={() => openCard(col.id, card)}
                >
                  <span className={`tag t-${card.tag}`}>{TAG_LABELS[card.tag]}</span>
                  <span className="title" style={card.titleColor ? { color: card.titleColor } : undefined}>
                    {card.title}
                  </span>
                  <span className="foot-row">
                    <span className="meta">{card.meta || ""}</span>
                    <span className="foot-icons">
                      {card.description && card.description.replace(/<[^>]+>/g, "").trim() && (
                        <span className="clip" title="A une description">
                          📝
                        </span>
                      )}
                      {card.attachments.length > 0 && (
                        <span className="clip">📎 {card.attachments.length}</span>
                      )}
                    </span>
                  </span>
                </button>
              ))}
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
      <dialog ref={dialogRef} className="card-modal" onClose={() => setSelected(null)}>
        {selectedCard && (
          <>
            <div className="cd-head">
              <div className="cd-title-wrap">
                <input
                  type="text"
                  className="cd-title"
                  value={selectedCard.title}
                  style={selectedCard.titleColor ? { color: selectedCard.titleColor } : undefined}
                  onChange={(e) => {
                    const value = e.target.value;
                    updateSelectedCard((c) => {
                      c.title = value;
                    });
                  }}
                />
                <div className="title-colors">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={"title-swatch" + (selectedCard.titleColor === c ? " active" : "")}
                      style={{ background: c }}
                      aria-label={`Couleur du titre ${c}`}
                      onClick={() =>
                        updateSelectedCard((card) => {
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
                      updateSelectedCard((card) => {
                        card.titleColor = undefined;
                      })
                    }
                  >
                    &times;
                  </button>
                </div>
              </div>
              <button type="button" className="cd-close" aria-label="Fermer" onClick={closeCard}>
                &times;
              </button>
            </div>
            <div className="cd-body">
              <div className="cd-meta-row">
                <span className={`tag t-${selectedCard.tag}`}>{TAG_LABELS[selectedCard.tag]}</span>
                {selectedCard.meta && <span className="meta">{selectedCard.meta}</span>}
              </div>

              <div>
                <div className="cd-section-label">Description</div>
                <RichTextEditor
                  key={selectedCard.id}
                  value={selectedCard.description ?? ""}
                  onSave={(html) => {
                    updateSelectedCard((c) => {
                      c.description = html;
                    });
                  }}
                />
              </div>

              <div>
                <div className="cd-section-label">Pièces jointes</div>
                {selectedCard.attachments.length === 0 ? (
                  <p className="attachment-empty">Aucune pièce jointe.</p>
                ) : (
                  <div className="attachment-list">
                    {selectedCard.attachments.map((a) =>
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
                          <textarea
                            className="attach-note"
                            placeholder="Petite note sur cette image…"
                            defaultValue={a.note ?? ""}
                            onBlur={(e) => updateAttachmentNote(a.id, e.target.value)}
                          />
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
