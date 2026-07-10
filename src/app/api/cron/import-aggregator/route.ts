// Vercel Cron: pull kids' events from regional "what's on" portals (Visit
// Angus etc.) into the REVIEW QUEUE. Incremental — aggregator_seen means each
// run only extracts listings we haven't processed before, so it never
// re-reviews the same thing and steady-state cost is tiny.
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`. We verify it.
// Query overrides (admin):
//   ?batch=N   max NEW detail pages to extract this run (default 25, max 80)
//   ?dry=1     don't write — just report what would happen

import { NextResponse } from "next/server";
import { runAggregatorImport } from "@/lib/aggregator-ingest";

export const maxDuration = 300;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const batch = Number(searchParams.get("batch")) || undefined;
  const dry = searchParams.get("dry") === "1";

  try {
    const result = await runAggregatorImport({ batch, dry });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
