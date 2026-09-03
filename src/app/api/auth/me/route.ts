import { NextRequest, NextResponse } from "next/server";
import { getSession, updateUserAvatar, updateOwnProfile } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const token = request.cookies.get("board_session")?.value;
  const session = await getSession(token);
  if (!session) {
    return NextResponse.json({ error: "Non connecté." }, { status: 401 });
  }
  return NextResponse.json(session);
}

// Self-service only -- always the session's own avatar, never a userId from
// the body, so nobody can overwrite someone else's photo through this route.
export async function PATCH(request: NextRequest) {
  const token = request.cookies.get("board_session")?.value;
  const session = await getSession(token);
  if (!session) {
    return NextResponse.json({ error: "Non connecté." }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Payload invalide." }, { status: 400 });
  }

  if ("avatarUrl" in body) {
    if (body.avatarUrl !== null && typeof body.avatarUrl !== "string") {
      return NextResponse.json({ error: "Avatar invalide." }, { status: 400 });
    }
    // Only ever trust a URL this app itself just handed back from
    // /api/upload -- never an arbitrary off-site URL, which would leak the
    // viewer's IP to that host every time the avatar renders.
    if (typeof body.avatarUrl === "string" && !body.avatarUrl.startsWith("/uploads/")) {
      return NextResponse.json({ error: "Avatar invalide." }, { status: 400 });
    }
    const user = await updateUserAvatar(session.userId, body.avatarUrl === null ? undefined : body.avatarUrl);
    return NextResponse.json(user);
  }

  // Everyone can edit their own username and password (never their role --
  // that stays admin-only, via PATCH /api/users/[id]). Changing the
  // password requires the current one.
  if ("username" in body || "newPassword" in body) {
    if (body.username !== undefined && typeof body.username !== "string") {
      return NextResponse.json({ error: "Identifiant invalide." }, { status: 400 });
    }
    if (body.newPassword !== undefined && typeof body.newPassword !== "string") {
      return NextResponse.json({ error: "Mot de passe invalide." }, { status: 400 });
    }
    try {
      const user = await updateOwnProfile(session.userId, {
        username: body.username,
        newPassword: body.newPassword,
        currentPassword: typeof body.currentPassword === "string" ? body.currentPassword : undefined,
      });
      return NextResponse.json(user);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 400 });
    }
  }

  return NextResponse.json({ error: "Payload invalide." }, { status: 400 });
}
