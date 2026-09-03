import { NextRequest, NextResponse } from "next/server";
import { getBoard, saveBoard, type BoardData, type Card } from "@/lib/store";
import { sanitizeDescription, sanitizeInline, sanitizeColor } from "@/lib/sanitize";
import { getSession, updateUserProjects } from "@/lib/auth";

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

// Admin, and any member never restricted by an admin (projectIds still
// undefined -- the default, so nobody is locked out by this feature
// existing), see the whole board. A restricted member only sees the
// projects on their allow-list.
function visibleProjectIds(session: Session | null, data: BoardData): Set<string> | null {
  if (!session || session.role === "admin" || !session.projectIds) return null;
  return new Set(session.projectIds);
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get("board_session")?.value;
  const session = await getSession(token);
  const data = await getBoard();
  const allowed = visibleProjectIds(session, data);
  if (!allowed) return NextResponse.json(data);
  return NextResponse.json({ projects: data.projects.filter((p) => allowed.has(p.id)) });
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
    // Cached other-language version of this comment (see /api/translate) --
    // same sanitizer as the live html, since it's rendered the same way.
    if (comment.translations && typeof comment.translations === "object") {
      for (const key of Object.keys(comment.translations)) {
        if (key !== "fr" && key !== "en") {
          delete comment.translations[key as "fr" | "en"];
          continue;
        }
        const html = comment.translations[key as "fr" | "en"];
        comment.translations[key as "fr" | "en"] = sanitizeDescription(html || "");
      }
    } else {
      comment.translations = undefined;
    }
  }

  // A reply's parentId must point at an existing comment on this same card
  // -- nesting is arbitrarily deep, any reply can itself be replied to.
  // Only two things get rejected, both collapsing back to top-level rather
  // than leaving a dangling reference: pointing at a comment that doesn't
  // exist (or itself), and a parent chain that would form a cycle -- the UI
  // never rewires an existing reply's target, so a cycle only happens by
  // hitting this API directly.
  const byId = new Map(card.comments.map((c) => [c.id, c]));
  for (const comment of card.comments) {
    if (!comment.parentId) continue;
    if (comment.parentId === comment.id || !byId.has(comment.parentId)) {
      comment.parentId = undefined;
      continue;
    }
    const seen = new Set<string>([comment.id]);
    let cur = byId.get(comment.parentId);
    let cyclic = false;
    while (cur) {
      if (seen.has(cur.id)) {
        cyclic = true;
        break;
      }
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    if (cyclic) comment.parentId = undefined;
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
        if (card.lang !== "fr" && card.lang !== "en") card.lang = undefined;
        for (const att of card.attachments ?? []) {
          if (att.note) att.note = sanitizeDescription(att.note);
        }
        // A label id that no longer exists on the project (deleted label)
        // just falls back to "no label" instead of pointing at nothing.
        if (card.labelId && !project.labels.some((l) => l.id === card.labelId)) {
          card.labelId = undefined;
        }
        // Cache of this card's other-language title/description/label name
        // (see /api/translate) -- same sanitizers as the live fields, since
        // switching language just swaps this cache in as the live content.
        if (card.translations && typeof card.translations === "object") {
          for (const key of Object.keys(card.translations)) {
            if (key !== "fr" && key !== "en") {
              delete card.translations[key as "fr" | "en"];
              continue;
            }
            const entry = card.translations[key as "fr" | "en"];
            if (!entry || typeof entry !== "object") {
              delete card.translations[key as "fr" | "en"];
              continue;
            }
            entry.title = sanitizeInline(entry.title || "");
            entry.description = sanitizeDescription(entry.description || "");
            entry.labelName = entry.labelName ? String(entry.labelName).trim().slice(0, 24) : undefined;
            if (entry.labelId && !project.labels.some((l) => l.id === entry.labelId)) {
              entry.labelId = undefined;
              entry.labelName = undefined;
            }
          }
        } else {
          card.translations = undefined;
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

  // A restricted member's own client only ever fetched their allowed
  // projects, so their payload naturally can't carry the others -- but this
  // endpoint doesn't only trust the client, same posture as comment
  // ownership above. Any project outside the session's allow-list is
  // restored from the last saved copy, untouched, regardless of what (if
  // anything) the payload says about it. A brand-new project id -- not
  // admin-gated, anyone can still create one -- is let through and granted
  // to its creator so they don't lose sight of what they just made.
  const allowed = visibleProjectIds(session, oldData);
  let grantNewProjectId: string | undefined;
  if (allowed) {
    const oldById = new Map(oldData.projects.map((p) => [p.id, p]));
    const incomingById = new Map(body.projects.map((p) => [p.id, p]));
    const merged = oldData.projects.map((p) => (allowed.has(p.id) ? incomingById.get(p.id) ?? p : p));
    for (const p of body.projects) {
      if (!oldById.has(p.id)) {
        merged.push(p);
        grantNewProjectId = p.id;
      }
    }
    body.projects = merged;
  }

  sanitizeBoard(body, oldData, session?.username);
  await saveBoard(body);
  if (grantNewProjectId && session) {
    await updateUserProjects(session.userId, [...(session.projectIds ?? []), grantNewProjectId]);
  }
  return NextResponse.json({ ok: true });
}
