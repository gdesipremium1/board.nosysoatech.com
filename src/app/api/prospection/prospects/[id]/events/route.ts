import { NextRequest, NextResponse } from "next/server";
import { addEvent } from "@/lib/prospection";
import { prospectionActor } from "@/lib/prospectionAuth";

// Append one event to a prospect's history; the pipeline stage follows
// automatically (see applyEventToProspect in src/lib/prospection.ts).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await prospectionActor(request);
  if (!actor) return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
  const { id } = await params;
  try {
    return NextResponse.json(await addEvent(id, body, actor), { status: 201 });
  } catch (err) {
    const message = (err as Error).message;
    return NextResponse.json({ error: message }, { status: message === "Prospect introuvable." ? 404 : 400 });
  }
}
