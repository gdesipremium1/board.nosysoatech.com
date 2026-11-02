import { NextRequest, NextResponse } from "next/server";
import { importFull } from "@/lib/prospection";
import { getSession } from "@/lib/auth";
import { hasValidApiKey, prospectionActor } from "@/lib/prospectionAuth";

// Full restore / merge of an export ({ prospects, events, doNotContact } from
// GET /api/prospection/export?format=json), keeping ids, dates and actors.
// ?dryRun=1 returns the report without writing anything (preview).
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
  if (!body || typeof body !== "object" || !Array.isArray(body.prospects) || !Array.isArray(body.events)) {
    return NextResponse.json(
      { error: "Fichier attendu : un export « Tout (JSON) » du board, avec prospects et events." },
      { status: 400 }
    );
  }
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const report = await importFull(body, actor, { dryRun });
  return NextResponse.json(report, { status: dryRun ? 200 : 201 });
}
