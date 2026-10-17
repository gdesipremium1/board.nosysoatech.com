import { NextRequest, NextResponse } from "next/server";
import { createProspects, listEvents, listProspects, parseCsv, rowsToProspectInputs } from "@/lib/prospection";
import { prospectionActor } from "@/lib/prospectionAuth";

const denied = () => NextResponse.json({ error: "Accès refusé." }, { status: 403 });

// Whole dataset in one call: the UI is a single screen and the volume
// (a few thousand prospects at most) stays small for JSON files.
export async function GET(request: NextRequest) {
  if (!(await prospectionActor(request))) return denied();
  const [prospects, events] = await Promise.all([listProspects(), listEvents()]);
  return NextResponse.json({ prospects, events });
}

// Accepts { prospect }, { prospects: [...] } or { csv, source } (import).
// Duplicates (same SIREN, else same name) are skipped, never overwritten.
export async function POST(request: NextRequest) {
  const actor = await prospectionActor(request);
  if (!actor) return denied();
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
  const source = typeof body.source === "string" ? body.source.trim().slice(0, 120) : undefined;

  let inputs: Record<string, unknown>[] = [];
  let imported = false;
  if (typeof body.csv === "string") {
    inputs = rowsToProspectInputs(parseCsv(body.csv));
    imported = true;
  } else if (Array.isArray(body.prospects)) {
    inputs = body.prospects.filter((p: unknown) => p && typeof p === "object");
    imported = body.prospects.length > 1;
  } else if (body.prospect && typeof body.prospect === "object") {
    inputs = [body.prospect];
  }
  if (inputs.length === 0) {
    return NextResponse.json({ error: "Aucun prospect valide (le nom est obligatoire)." }, { status: 400 });
  }
  const result = await createProspects(inputs, actor, { imported, source });
  return NextResponse.json(result, { status: 201 });
}
