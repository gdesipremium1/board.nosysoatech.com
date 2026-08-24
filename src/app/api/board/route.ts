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
    for (const column of project.columns) {
      for (const card of column.cards) {
        if (card.description) {
          card.description = sanitizeDescription(card.description);
        }
        card.titleColor = sanitizeColor(card.titleColor);
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
