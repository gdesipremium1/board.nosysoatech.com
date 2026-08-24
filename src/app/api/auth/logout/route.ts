import { NextRequest, NextResponse } from "next/server";
import { logout } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const token = request.cookies.get("board_session")?.value;
  if (token) await logout(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("board_session");
  return res;
}
