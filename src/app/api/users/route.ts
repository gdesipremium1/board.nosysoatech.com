import { NextRequest, NextResponse } from "next/server";
import { listUsers, createUser, getSession } from "@/lib/auth";

async function requireAdmin(request: NextRequest) {
  const token = request.cookies.get("board_session")?.value;
  const session = await getSession(token);
  if (!session || session.role !== "admin") return null;
  return session;
}

export async function GET(request: NextRequest) {
  const session = await requireAdmin(request);
  if (!session) return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  return NextResponse.json(await listUsers());
}

export async function POST(request: NextRequest) {
  const session = await requireAdmin(request);
  if (!session) return NextResponse.json({ error: "Accès refusé." }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.username || !body?.password) {
    return NextResponse.json({ error: "Identifiant et mot de passe requis." }, { status: 400 });
  }
  if (String(body.password).length < 8) {
    return NextResponse.json({ error: "Mot de passe trop court (8 caractères minimum)." }, { status: 400 });
  }

  try {
    const user = await createUser(body.username, body.password, body.role === "admin" ? "admin" : "member");
    return NextResponse.json(user);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
  }
}
