import { NextRequest, NextResponse } from "next/server";
import { getBoard, saveBoard, type BoardData, type Card } from "@/lib/store";
import { sanitizeDescription, sanitizeInline, sanitizeColor } from "@/lib/sanitize";
import { getSession } from "@/lib/auth";

export async function GET() {
  const data = await getBoard();
  return NextResponse.json(data);
}

function allCards(data: BoardData): Card[] {
  return data.projects.flatMap((p) => p.columns.flatMap((c) => c.cards));
}

// Comments carry an author and are only editable by that author. The client
// is trusted for almost everything else in this app (titles, labels,
// attachments...), but ownership is the one place this endpoint actually
// enforces something server-side: for a brand-new comment the author is
// always stamped from the session (never taken from the client), and an
// edit to an existing comment's content is only kept if the session user
// matches who originally wrote it -- otherwise that one field is quietly
// reverted rather than failing the whole save.
function sanitizeComments(card: Card, oldCard: Card | undefined, sessionUsername: string | undefined): void {
  if (!Array.isArray(card.comments)) {
    card.comments = [];
    return;
  }
  const oldById = new Map((oldCard?.comments ?? []).map((c) => [c.id, c]));
  const validIds = new Set(card.comments.map((c) => c.id));

  for (const comment of card.comments) {
    const old = oldById.get(comment.id);
    if (!old) {
      // Brand-new comment: the author and creation date are never taken
      // from the client.
      comment.authorUsername = sessionUsername ?? "?";
      comment.createdAt = new Date().toISOString();
      comment.editedAt = undefined;
    } else {
      comment.authorUsername = old.authorUsername;
      comment.createdAt = old.createdAt;
      const htmlChanged = comment.html !== old.html;
      const attachmentsChanged = JSON.stringify(comment.attachments) !== JSON.stringify(old.attachments);
      if ((htmlChanged || attachmentsChanged) && old.authorUsername !== sessionUsername) {
        // Not the original author -- discard the edit, keep the old content.
        comment.html = old.html;
        comment.attachments = old.attachments;
        comment.editedAt = old.editedAt;
      } else if (htmlChanged || attachmentsChanged) {
        comment.editedAt = new Date().toISOString();
      } else {
        comment.editedAt = old.editedAt;
      }
    }
    comment.html = sanitizeDescription(comment.html || "");
    if (!Array.isArray(comment.attachments)) comment.attachments = [];
    // A reply's parentId must point at an existing top-level comment on
    // this same card; anything else collapses it back to top-level rather
    // than leaving it pointing at nothing (or at itself).
    if (comment.parentId) {
      const parent = card.comments.find((c) => c.id === comment.parentId);
      if (!parent || parent.parentId || comment.parentId === comment.id) {
        comment.parentId = undefined;
      }
    }
  }
  card.comments = card.comments.filter((c) => validIds.has(c.id));
}

// The description editor's toolbar only offers a safe subset of HTML, but
// that's a UI nicety, not the security boundary -- this endpoint accepts
// raw JSON, so anyone with a session could POST arbitrary HTML directly.
// Every card description (and comment) is re-sanitized here, server-side,
// on every save.
function sanitizeBoard(data: BoardData, oldData: BoardData, sessionUsername: string | undefined): void {
  const oldCardsById = new Map(allCards(oldData).map((c) => [c.id, c]));
  for (const project of data.projects) {
    if (!Array.isArray(project.labels)) project.labels = [];
    for (const label of project.labels) {
      label.name = String(label.name ?? "").trim().slice(0, 24);
      label.color = sanitizeColor(label.color) ?? "#565f56";
    }
    for (const column of project.columns) {
      for (const card of column.cards) {
        const oldCard = oldCardsById.get(card.id);
        // Title now goes through the same Tiptap editor as description
        // (bold/color only, no headings/lists -- see RichTextEditor's
        // `minimal` mode), so it needs the same server-side treatment.
        // sanitizeInline strips block tags entirely rather than just
        // discarding them, so the result is always safe to embed inline
        // (card face, sub-ticket rows, the move menu...). If sanitizing
        // ever empties it out, fall back to the previous title rather
        // than persist a blank, unclickable-looking card.
        card.title = sanitizeInline(card.title || "");
        if (!card.title.trim()) {
          card.title = oldCard?.title || "(sans titre)";
        }
        if (card.description) {
          card.description = sanitizeDescription(card.description);
        }
        card.titleColor = sanitizeColor(card.titleColor);
        for (const att of card.attachments ?? []) {
          if (att.note) att.note = sanitizeDescription(att.note);
        }
        // A label id that no longer exists on the project (deleted label)
        // just falls back to "no label" instead of pointing at nothing.
        if (card.labelId && !project.labels.some((l) => l.id === card.labelId)) {
          card.labelId = undefined;
        }
        sanitizeComments(card, oldCard, sessionUsername);
      }
    }
  }
}

export async function PUT(request: NextRequest) {
  let body: BoardData;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }
  if (!body || !Array.isArray(body.projects)) {
    return NextResponse.json({ error: "Payload invalide." }, { status: 400 });
  }
  const token = request.cookies.get("board_session")?.value;
  const session = await getSession(token);
  const oldData = await getBoard();
  sanitizeBoard(body, oldData, session?.username);
  await saveBoard(body);
  return NextResponse.json({ ok: true });
}
