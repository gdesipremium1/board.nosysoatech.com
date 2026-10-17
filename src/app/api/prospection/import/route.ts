import { NextRequest, NextResponse } from "next/server";
import { importFull } from "@/lib/prospection";
import { getSession } from "@/lib/auth";
import { hasValidApiKey, prospectionActor } from "@/lib/prospectionAuth";

// Full restore of an export ({ prospects, events } from
// GET /api/prospection/export?format=json), keeping ids, dates and actors.
// Heavier than the regular create endpoint, so limited to the API key and
// to admins (not managers).
export async function POST(request: NextRequest) {
  const actor = await prospectionActor(request);
  if (!actor) return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  if (!hasValidApiKey(request)) {
    const session = await getSession(request.cookies.get("board_session")?.value);
    if (session?.role !== "admin") return NextResponse.json({ error: "Réservé aux admins." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || (!Array.isArray(body.prospects) && !Array.isArray(body.events))) {
    return NextResponse.json({ error: "Format attendu : { prospects: [...], events: [...] }." }, { status: 400 });
  }
  return NextResponse.json(await importFull(body, actor), { status: 201 });
}
