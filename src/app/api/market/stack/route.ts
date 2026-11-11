import { NextRequest, NextResponse } from "next/server";
import { listStackStudies, saveStackStudy } from "@/lib/market";
import { prospectionActor } from "@/lib/prospectionAuth";

// "Stacks rentables" studies; same access rules as /api/market
// (scripts/market/stack.py output is posted here).

const denied = () => NextResponse.json({ error: "Accès refusé." }, { status: 403 });

export async function GET(request: NextRequest) {
  if (!(await prospectionActor(request))) return denied();
  return NextResponse.json({ studies: await listStackStudies() });
}

export async function POST(request: NextRequest) {
  if (!(await prospectionActor(request))) return denied();
  const study = await saveStackStudy(await request.json().catch(() => null));
  if (!study) return NextResponse.json({ error: "Étude invalide." }, { status: 400 });
  return NextResponse.json({ study }, { status: 201 });
}
