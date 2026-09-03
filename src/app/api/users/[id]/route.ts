import { NextRequest, NextResponse } from "next/server";
import { deleteUser, updateUserProjects, getSession } from "@/lib/auth";
import { getBoard } from "@/lib/store";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = request.cookies.get("board_session")?.value;
  const session = await getSession(token);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }
  const { id } = await params;
  if (id === session.userId) {
    return NextResponse.json({ error: "Tu ne peux pas te supprimer toi-même." }, { status: 400 });
  }
  await deleteUser(id);
  return NextResponse.json({ ok: true });
}

// Admin-only: set which projects a member can see. Every id is checked
// against the board's real projects so a stale/typo'd id can't linger in
// the list -- same defensive posture as labelId elsewhere in this app.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = request.cookies.get("board_session")?.value;
  const session = await getSession(token);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  // null = clear the restriction (back to "sees every project"); an array
  // = the explicit allow-list, including an intentionally empty one.
  if (!body || (body.projectIds !== null && !Array.isArray(body.projectIds))) {
    return NextResponse.json({ error: "Liste de projets invalide." }, { status: 400 });
  }
  if (Array.isArray(body.projectIds) && body.projectIds.some((p: unknown) => typeof p !== "string")) {
    return NextResponse.json({ error: "Liste de projets invalide." }, { status: 400 });
  }
  const { id } = await params;
  let projectIds: string[] | undefined;
  if (body.projectIds === null) {
    projectIds = undefined;
  } else {
    const board = await getBoard();
    const validIds = new Set(board.projects.map((p) => p.id));
    projectIds = Array.from(new Set((body.projectIds as string[]).filter((p) => validIds.has(p))));
  }

  try {
    const user = await updateUserProjects(id, projectIds);
    return NextResponse.json(user);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
  }
}
