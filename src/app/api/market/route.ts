import { NextRequest, NextResponse } from "next/server";
import { listStudies, saveStudy } from "@/lib/market";
import { prospectionActor } from "@/lib/prospectionAuth";

// Same access rules as the prospection API: admin/manager session, or the
// automation key (the collection script posts each new study here).

const denied = () => NextResponse.json({ error: "Accès refusé." }, { status: 403 });

export async function GET(request: NextRequest) {
  if (!(await prospectionActor(request))) return denied();
  return NextResponse.json({ studies: await listStudies() });
}

export async function POST(request: NextRequest) {
  if (!(await prospectionActor(request))) return denied();
  const study = await saveStudy(await request.json().catch(() => null));
  if (!study) return NextResponse.json({ error: "Étude invalide." }, { status: 400 });
  return NextResponse.json({ study }, { status: 201 });
}
