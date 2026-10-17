import { NextRequest, NextResponse } from "next/server";
import { eventsToCsv, listEvents, listProspects, prospectsToCsv } from "@/lib/prospection";
import { prospectionActor } from "@/lib/prospectionAuth";

// ?format=csv|json  &dataset=prospects|events  (json without dataset = both)
export async function GET(request: NextRequest) {
  if (!(await prospectionActor(request))) {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }
  const format = request.nextUrl.searchParams.get("format") === "csv" ? "csv" : "json";
  const dataset = request.nextUrl.searchParams.get("dataset");
  const [prospects, events] = await Promise.all([listProspects(), listEvents()]);
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "json") {
    const payload =
      dataset === "prospects" ? prospects : dataset === "events" ? events : { exportedAt: new Date().toISOString(), prospects, events };
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="prospection-${dataset ?? "complet"}-${stamp}.json"`,
      },
    });
  }
  const isEvents = dataset === "events";
  // BOM so Excel opens the UTF-8 accents correctly.
  const csv = "﻿" + (isEvents ? eventsToCsv(events, prospects) : prospectsToCsv(prospects));
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="prospection-${isEvents ? "evenements" : "prospects"}-${stamp}.csv"`,
    },
  });
}
