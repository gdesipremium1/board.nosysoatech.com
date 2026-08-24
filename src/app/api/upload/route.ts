import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const MAX_SIZE = 15 * 1024 * 1024; // 15 Mo

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Fichier trop volumineux (15 Mo max)." }, { status: 400 });
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });

  const id = crypto.randomUUID();
  const ext = path.extname(file.name).replace(/[^a-zA-Z0-9.]/g, "").slice(0, 12);
  const storedName = id + ext;
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(UPLOAD_DIR, storedName), buffer);

  return NextResponse.json({
    id,
    filename: file.name,
    url: `/uploads/${storedName}`,
    size: file.size,
    mime: file.type || "application/octet-stream",
    uploadedAt: new Date().toISOString(),
  });
}
