// Vercel Cron: auto-enrich venues from Google (via Apify) — photos, opening
// hours, website, phone, rating, address, coords — for anything missing.
// Marks each venue tried so it processes the backlog once, then idles (picking
// up new venues as they appear). Auth: Bearer ${CRON_SECRET}.
// ?batch=N to override the per-run size (max 12).

import { NextResponse } from "next/server";
import { runEnrichmentCron } from "@/app/admin/venues-photos-hours/actions";

export const maxDuration = 300;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const batch = Number(new URL(req.url).searchParams.get("batch")) || 10;
  const result = await runEnrichmentCron(secret, batch);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
