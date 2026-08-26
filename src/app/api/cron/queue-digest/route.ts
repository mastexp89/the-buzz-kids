// Vercel Cron: once each morning, post a review-queue digest to the admins
// Telegram group IF there's anything waiting (pending events, edit
// suggestions, places to add, reviews). Sends nothing when the queue is
// empty — no "all clear" noise.
//
// Telegram only. There used to be a daily admin email too (later a
// Telegram-failure fallback); Dylan works the whole queue from the bot now —
// every batch of cards ends with a pager — so the email was pure duplication
// and has been removed. If Telegram is down the queue is still there in
// /admin; we don't fall back to email.
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`. We verify it.
// ?dry=1 to compute counts without sending.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { tgQueueDigest } from "@/lib/telegram";
import { sendPendingEventButtons, sendAggregatorPlaceCards } from "@/lib/telegram-queue";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const sb = createServiceClient();

  async function count(table: string, col: string, filter: (q: any) => any): Promise<number> {
    try {
      const { count } = await filter(sb.from(table).select(col, { count: "exact", head: true }));
      return count ?? 0;
    } catch {
      return 0;
    }
  }

  const events = await count("events", "id", (q) => q.eq("status", "pending"));
  const suggestions = await count("edit_suggestions", "id", (q) => q.eq("status", "new"));
  const places = await count("aggregator_places", "id", (q) => q.eq("status", "new"));
  const reviews = await count("reviews", "id", (q) => q.eq("status", "pending"));
  const total = events + suggestions + places;

  if (total === 0 && reviews === 0) return NextResponse.json({ ok: true, total, sent: false });
  if (dry) return NextResponse.json({ ok: true, events, suggestions, places, reviews, total, sent: false });

  // Telegram: digest into the admins group, then the first few pending events
  // and aggregator places as individual cards with one-tap actions + a pager.
  let telegramOk = false;
  try {
    telegramOk = await tgQueueDigest({ events, suggestions, places, reviews });
    if (events > 0) await sendPendingEventButtons(5);
    if (places > 0) await sendAggregatorPlaceCards(5);
  } catch { telegramOk = false; }

  return NextResponse.json({
    ok: true, events, suggestions, places, reviews, total,
    sent: telegramOk, channel: "telegram",
  });
}
