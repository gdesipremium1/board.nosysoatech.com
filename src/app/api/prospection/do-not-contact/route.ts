import { NextRequest, NextResponse } from "next/server";
import { addDoNotContact, listDoNotContact } from "@/lib/prospection";
import { prospectionActor } from "@/lib/prospectionAuth";

const denied = () => NextResponse.json({ error: "Accès refusé." }, { status: 403 });

// "Ne plus contacter" list: to be checked before any new outreach.
export async function GET(request: NextRequest) {
  if (!(await prospectionActor(request))) return denied();
  return NextResponse.json({ doNotContact: await listDoNotContact() });
}

// Adds a domain (or an address) without an existing prospect, e.g. a
// removal request received from someone not in the board yet.
// Body: { domain, reason? } or { domains: [...], reason? }.
export async function POST(request: NextRequest) {
  const actor = await prospectionActor(request);
  if (!actor) return denied();
  const body = await request.json().catch(() => null);
  const domains: unknown[] = Array.isArray(body?.domains) ? body.domains : [body?.domain];
  const reason = typeof body?.reason === "string" ? body.reason : undefined;
  const entries = domains.filter((d): d is string => typeof d === "string" && !!d.trim()).map((domain) => ({ domain, reason }));
  if (entries.length === 0) return NextResponse.json({ error: "Domaine manquant." }, { status: 400 });
  const added = await addDoNotContact(entries, actor);
  return NextResponse.json({ added, doNotContact: await listDoNotContact() }, { status: 201 });
}
