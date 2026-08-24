import { NextRequest, NextResponse } from "next/server";
import { deleteUser, getSession } from "@/lib/auth";

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
