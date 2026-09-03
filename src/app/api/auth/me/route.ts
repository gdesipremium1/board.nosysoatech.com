import { NextRequest, NextResponse } from "next/server";
import { getSession, updateUserAvatar } from "@/lib/auth";

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
  if (!body || (body.avatarUrl !== null && typeof body.avatarUrl !== "string")) {
    return NextResponse.json({ error: "Avatar invalide." }, { status: 400 });
  }
  // Only ever trust a URL this app itself just handed back from /api/upload
  // -- never an arbitrary off-site URL, which would leak the viewer's IP to
  // that host every time the avatar renders.
  if (typeof body.avatarUrl === "string" && !body.avatarUrl.startsWith("/uploads/")) {
    return NextResponse.json({ error: "Avatar invalide." }, { status: 400 });
  }
  const user = await updateUserAvatar(session.userId, body.avatarUrl === null ? undefined : body.avatarUrl);
  return NextResponse.json(user);
}
