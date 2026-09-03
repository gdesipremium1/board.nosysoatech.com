import { NextRequest, NextResponse } from "next/server";
import { listUsers, createUser, getSession, type Role } from "@/lib/auth";

async function requireSession(request: NextRequest) {
  const token = request.cookies.get("board_session")?.value;
  return getSession(token);
}

// Admin and manager both need the user list -- a manager to pick candidates
// for the "add participant" panel on a project it can reach. Creating
// accounts stays admin-only below.
export async function GET(request: NextRequest) {
  const session = await requireSession(request);
  if (!session || (session.role !== "admin" && session.role !== "manager")) {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }
  return NextResponse.json(await listUsers());
}

export async function POST(request: NextRequest) {
  const session = await requireSession(request);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.username || !body?.password) {
    return NextResponse.json({ error: "Identifiant et mot de passe requis." }, { status: 400 });
  }
  if (String(body.password).length < 8) {
    return NextResponse.json({ error: "Mot de passe trop court (8 caractères minimum)." }, { status: 400 });
  }
  const role: Role = body.role === "admin" || body.role === "manager" ? body.role : "member";

  try {
    const user = await createUser(body.username, body.password, role);
    return NextResponse.json(user);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
  }
}
