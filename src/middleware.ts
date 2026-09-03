import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

const PUBLIC_PATHS = ["/login", "/api/auth/login"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/uploads/") ||
    pathname.startsWith("/_next/")
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get("board_session")?.value;
  const session = await getSession(token);

  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // The full user-management page (create/delete accounts, change roles)
  // stays admin-only. The /api/users endpoints underneath it are not
  // gated here anymore -- a manager also needs read access (to list
  // candidates) and a narrow write (granting a project to someone) for the
  // per-project "participants" panel on the board itself; each route
  // handler enforces its own, more specific rule per HTTP verb.
  if (pathname === "/users" && session.role !== "admin") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
