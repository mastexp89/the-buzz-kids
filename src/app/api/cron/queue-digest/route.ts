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
import { tgQueueDigest, sendTelegram } from "@/lib/telegram";
import { eventIsOver } from "@/lib/auto-approve";
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

  // 1) Clear queued events that would only ever be rejected, so nobody has to
  //    tap through them: the date has already gone, or there's no venue
  //    (house rule — no-venue events are always declined).
  let expired = 0;
  if (!dry) {
    const { data: pend } = await sb
      .from("events")
      .select("id, venue_id, start_time, end_time, end_date, recurrence_pattern, recurrence_until")
      .eq("status", "pending")
      .limit(2000);
    const over = (pend ?? [])
      .filter((e: any) => !e.venue_id || eventIsOver(e))
      .map((e: any) => e.id as string);
    for (let i = 0; i < over.length; i += 200) {
      await sb
        .from("events")
        .update({ status: "rejected", reviewed_at: new Date().toISOString() })
        .in("id", over.slice(i, i + 200));
    }
    expired = over.length;
  }

  // 2) Imports that went straight live in the last 24h (confident reads in a
  //    Buzz Kids category — see lib/auto-approve.ts). No reviewer = automatic.
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const autoApproved = await count("events", "id", (q) =>
    q.eq("status", "approved").is("reviewed_by", null).not("auto_imported_from", "is", null).gte("reviewed_at", since),
  );

  const events = await count("events", "id", (q) => q.eq("status", "pending"));
  const suggestions = await count("edit_suggestions", "id", (q) => q.eq("status", "new"));
  const places = await count("aggregator_places", "id", (q) => q.eq("status", "new"));
  const reviews = await count("reviews", "id", (q) => q.eq("status", "pending"));
  const total = events + suggestions + places;

  if (total === 0 && reviews === 0 && autoApproved === 0 && expired === 0) {
    return NextResponse.json({ ok: true, total, sent: false });
  }
  if (dry) return NextResponse.json({ ok: true, events, suggestions, places, reviews, total, autoApproved, sent: false });

  // Telegram: a one-line heads-up about what went live on its own, then the
  // digest + the first few cards that still need a human, with a pager.
  let telegramOk = false;
  try {
    if (autoApproved > 0 || expired > 0) {
      const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.thebuzzkids.co.uk";
      const lines = [
        autoApproved > 0
          ? `✅ <b>${autoApproved} new event${autoApproved === 1 ? "" : "s"} auto-approved</b> overnight — upcoming, in Buzz Kids categories and read confidently, so they're live.`
          : null,
        expired > 0
          ? `🗑 Declined ${expired} queued event${expired === 1 ? "" : "s"} that had no venue or whose date had already passed.`
          : null,
      ].filter(Boolean);
      telegramOk = await sendTelegram(lines.join("\n"), {
        silent: true,
        buttons: [[{ text: "🔍 See What's On", url: `${site}/browse?tab=events` }]],
      });
    }
    if (total > 0 || reviews > 0) {
      telegramOk = await tgQueueDigest({ events, suggestions, places, reviews });
      if (events > 0) await sendPendingEventButtons(5);
      if (places > 0) await sendAggregatorPlaceCards(5);
    }
  } catch { telegramOk = false; }

  return NextResponse.json({
    ok: true, events, suggestions, places, reviews, total, autoApproved, expired,
    sent: telegramOk, channel: "telegram",
  });
}
