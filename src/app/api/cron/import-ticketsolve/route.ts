// Vercel Cron: weekly import of kids/family shows from venues' Ticketsolve
// box-office feeds (see lib/ticketsolve-ingest.ts). New confident kids' shows
// go live; uncertain ones land in the Telegram queue via the 7am digest.
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`. ?dry=1 counts
// what would be read without any AI calls or writes.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ingestTicketsolve } from "@/lib/ticketsolve-ingest";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const result = await ingestTicketsolve(createServiceClient(), { dry });
  return NextResponse.json({ ok: true, dry, ...result });
}
