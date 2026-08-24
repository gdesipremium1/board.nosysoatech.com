import { NextRequest, NextResponse } from "next/server";
import { getBoard, saveBoard, type BoardData } from "@/lib/store";

export async function GET() {
  const data = await getBoard();
  return NextResponse.json(data);
}

export async function PUT(request: NextRequest) {
  let body: BoardData;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }
  if (!body || !Array.isArray(body.projects)) {
    return NextResponse.json({ error: "Payload invalide." }, { status: 400 });
  }
  await saveBoard(body);
  return NextResponse.json({ ok: true });
}
