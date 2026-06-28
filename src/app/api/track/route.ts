// Lightweight click-tracking endpoint. Client uses navigator.sendBeacon to
// fire-and-forget when a user clicks a tracked link, so the page navigation
// isn't delayed by waiting on the response.
//
// We don't auth this endpoint — anyone can record an analytics row. The same
// pattern we already use for page views.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const ALLOWED_KINDS = new Set([
  "click_phone",
  "click_website",
  "click_maps",
  "click_email",
  "click_facebook",
  "click_instagram",
  "click_twitter",
  "click_tiktok",
  "click_youtube",
  "click_spotify",
  "click_bandcamp",
  "click_share",
  "click_ticket",
  "click_artist",
  "click_venue",
]);

const BOT_PATTERNS =
  /bot\b|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|slackbot|discordbot|linkedinbot|twitterbot|skypeuripreview|googlebot|bingbot|yandexbot|duckduckbot|baiduspider|ahrefsbot|semrushbot|petalbot|applebot|gptbot|claude|chatgpt|perplexity|headlesschrome|puppeteer|playwright|phantomjs|selenium/i;

export async function POST(req: Request) {
  try {
    const ua = req.headers.get("user-agent") ?? "";
    if (!ua || BOT_PATTERNS.test(ua)) {
      return NextResponse.json({ ok: true, skipped: "bot" });
    }

    const body = await req.json().catch(() => ({}));
    const kind = String(body?.kind ?? "");
    if (!ALLOWED_KINDS.has(kind)) {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }

    const venueId = typeof body?.venueId === "string" ? body.venueId : null;
    const artistId = typeof body?.artistId === "string" ? body.artistId : null;
    const eventId = typeof body?.eventId === "string" ? body.eventId : null;
    if (!venueId && !artistId && !eventId) {
      return NextResponse.json({ error: "Missing target" }, { status: 400 });
    }

    const sb = createServiceClient();
    await sb.from("page_views").insert({
      kind,
      venue_id: venueId,
      artist_id: artistId,
      event_id: eventId,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "track failed" }, { status: 500 });
  }
}
