import crypto from "crypto";
import type { NextRequest } from "next/server";
import { getSession } from "./auth";

// Two ways into /api/prospection/*:
//  - the usual board_session cookie, restricted to admin and manager
//    (prospects are business data, participants don't see them);
//  - "Authorization: Bearer <PROSPECTION_API_KEY>", for automation (Claude
//    recording drafts, sends and replies on the online board). Disabled
//    entirely while the env var is unset. The actor name stamped on events
//    comes from the X-Actor header, "claude" by default.

export function hasValidApiKey(request: NextRequest): boolean {
  const expected = process.env.PROSPECTION_API_KEY?.trim();
  if (!expected || expected.length < 16) return false;
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  const given = Buffer.from(match[1].trim());
  const want = Buffer.from(expected);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

export async function prospectionActor(request: NextRequest): Promise<string | null> {
  if (hasValidApiKey(request)) {
    const actor = (request.headers.get("x-actor") ?? "claude").trim().slice(0, 40);
    return actor || "claude";
  }
  const session = await getSession(request.cookies.get("board_session")?.value);
  if (!session || (session.role !== "admin" && session.role !== "manager")) return null;
  return session.username;
}
