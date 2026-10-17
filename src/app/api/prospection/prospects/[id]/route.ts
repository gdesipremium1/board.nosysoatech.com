import { NextRequest, NextResponse } from "next/server";
import { listEvents, listProspects, updateProspect } from "@/lib/prospection";
import { prospectionActor } from "@/lib/prospectionAuth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await prospectionActor(request))) {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }
  const { id } = await params;
  const prospect = (await listProspects()).find((p) => p.id === id);
  if (!prospect) return NextResponse.json({ error: "Prospect introuvable." }, { status: 404 });
  return NextResponse.json({ prospect, events: await listEvents(id) });
}

// Field edits only. Stage moves, archiving and everything else that
// belongs in the history go through POST .../events instead.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await prospectionActor(request);
  if (!actor) return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
  const { id } = await params;
  try {
    return NextResponse.json({ prospect: await updateProspect(id, body, actor) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }
}
