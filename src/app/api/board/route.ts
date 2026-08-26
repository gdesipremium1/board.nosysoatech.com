import { NextRequest, NextResponse } from "next/server";
import { getBoard, saveBoard, type BoardData } from "@/lib/store";
import { sanitizeDescription, sanitizeColor } from "@/lib/sanitize";

export async function GET() {
  const data = await getBoard();
  return NextResponse.json(data);
}

// The description editor's toolbar only offers a safe subset of HTML, but
// that's a UI nicety, not the security boundary -- this endpoint accepts
// raw JSON, so anyone with a session could POST arbitrary HTML directly.
// Every card description is re-sanitized here, server-side, on every save.
function sanitizeBoard(data: BoardData): void {
  for (const project of data.projects) {
    if (!Array.isArray(project.labels)) project.labels = [];
    for (const label of project.labels) {
      label.name = String(label.name ?? "").trim().slice(0, 24);
      label.color = sanitizeColor(label.color) ?? "#565f56";
    }
    for (const column of project.columns) {
      for (const card of column.cards) {
        if (card.description) {
          card.description = sanitizeDescription(card.description);
        }
        card.titleColor = sanitizeColor(card.titleColor);
        // A label id that no longer exists on the project (deleted label)
        // just falls back to "no label" instead of pointing at nothing.
        if (card.labelId && !project.labels.some((l) => l.id === card.labelId)) {
          card.labelId = undefined;
        }
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
  sanitizeBoard(body);
  await saveBoard(body);
  return NextResponse.json({ ok: true });
}
