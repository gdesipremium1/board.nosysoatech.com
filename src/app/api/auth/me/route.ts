import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const token = request.cookies.get("board_session")?.value;
  const session = await getSession(token);
  if (!session) {
    return NextResponse.json({ error: "Non connecté." }, { status: 401 });
  }
  return NextResponse.json(session);
}
