import { NextRequest, NextResponse } from "next/server";

// Plain-text-in, plain-text-out translation via MyMemory
// (https://mymemory.translated.net) -- free, no API key. It has no batch
// endpoint, so each string is a separate request; done sequentially rather
// than in parallel to stay well under the anonymous-tier rate limit. HTML
// structure (paragraphs, bold, headings) is handled by the caller, which
// splits a card's rich text into plain paragraphs before calling this and
// re-wraps the translated paragraphs into HTML after -- this endpoint only
// ever sees/returns plain strings.
const MAX_TEXTS = 60;
const MAX_TEXT_LENGTH = 500; // MyMemory's own per-request limit, roughly

async function translateOne(text: string, from: string, to: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const capped = trimmed.slice(0, MAX_TEXT_LENGTH);
  const url =
    "https://api.mymemory.translated.net/get?q=" +
    encodeURIComponent(capped) +
    "&langpair=" +
    encodeURIComponent(`${from}|${to}`);
  try {
    const res = await fetch(url);
    if (!res.ok) return text;
    const json = await res.json();
    const translated = json?.responseData?.translatedText;
    return typeof translated === "string" && translated.trim() ? translated : text;
  } catch {
    return text; // network hiccup -- keep the original rather than lose it
  }
}

export async function POST(request: NextRequest) {
  let body: { texts?: unknown; from?: unknown; to?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }
  const { texts, from, to } = body;
  if (
    !Array.isArray(texts) ||
    texts.some((t) => typeof t !== "string") ||
    (from !== "fr" && from !== "en") ||
    (to !== "fr" && to !== "en")
  ) {
    return NextResponse.json({ error: "Payload invalide." }, { status: 400 });
  }
  if (texts.length > MAX_TEXTS) {
    return NextResponse.json({ error: "Trop de textes à traduire en une fois." }, { status: 400 });
  }
  if (from === to) {
    return NextResponse.json({ translations: texts });
  }

  const translations: string[] = [];
  for (const text of texts as string[]) {
    translations.push(await translateOne(text, from, to));
  }
  return NextResponse.json({ translations });
}
