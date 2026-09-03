import { NextRequest, NextResponse } from "next/server";
import { deleteUser, updateUserProjects, updateUserRole, listUsers, getSession, type Role } from "@/lib/auth";
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

// Three different things can land here, gated differently:
//  - { grantProjectId } -- admin OR manager, additive-only, capped to a
//    project the caller can themselves reach. This is the "add a
//    participant from inside a project" flow.
//  - { projectIds } -- admin only, full replace (including clearing the
//    restriction with null). This is the /users admin page's picker.
//  - { role } -- admin only, and never on your own account (no accidental
//    self-demotion out of the only admin seat).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = request.cookies.get("board_session")?.value;
  const session = await getSession(token);
  if (!session || (session.role !== "admin" && session.role !== "manager")) {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const { id } = await params;

  if (body && typeof body.grantProjectId === "string") {
    const grantId = body.grantProjectId;
    const board = await getBoard();
    if (!board.projects.some((p) => p.id === grantId)) {
      return NextResponse.json({ error: "Projet introuvable." }, { status: 400 });
    }
    const callerOwnScope = session.role === "admin" || !session.projectIds || session.projectIds.includes(grantId);
    if (!callerOwnScope) {
      return NextResponse.json({ error: "Tu n'as pas accès à ce projet toi-même." }, { status: 403 });
    }
    const users = await listUsers();
    const target = users.find((u) => u.id === id);
    if (!target) return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
    // Admin, or already unrestricted -- there's nothing to add, they can
    // already see this project.
    if (target.role === "admin" || target.projectIds === undefined) {
      return NextResponse.json(target);
    }
    const nextIds = Array.from(new Set([...target.projectIds, grantId]));
    const updated = await updateUserProjects(id, nextIds);
    return NextResponse.json(updated);
  }

  if (body && typeof body.role === "string") {
    if (session.role !== "admin") {
      return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
    }
    if (id === session.userId) {
      return NextResponse.json({ error: "Tu ne peux pas changer ton propre rôle." }, { status: 400 });
    }
    if (body.role !== "admin" && body.role !== "manager" && body.role !== "member") {
      return NextResponse.json({ error: "Rôle invalide." }, { status: 400 });
    }
    try {
      const updated = await updateUserRole(id, body.role as Role);
      return NextResponse.json(updated);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
    }
  }

  // Full-replace project list -- admin only.
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }
  // null = clear the restriction (back to "sees every project"); an array
  // = the explicit allow-list, including an intentionally empty one.
  if (!body || (body.projectIds !== null && !Array.isArray(body.projectIds))) {
    return NextResponse.json({ error: "Liste de projets invalide." }, { status: 400 });
  }
  if (Array.isArray(body.projectIds) && body.projectIds.some((p: unknown) => typeof p !== "string")) {
    return NextResponse.json({ error: "Liste de projets invalide." }, { status: 400 });
  }
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
