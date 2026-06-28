// Server-side page-view tracker. Insert is fire-and-forget — never let an
// analytics failure break the page render.
//
// Bot filter is intentionally permissive: we'd rather count one or two bot
// visits than miss real users. Common search-crawlers, link-preview bots
// and headless tools are excluded.

import { headers } from "next/headers";
import { createServiceClient } from "./supabase/service";

const BOT_PATTERNS =
  /bot\b|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|slackbot|discordbot|linkedinbot|twitterbot|skypeuripreview|googlebot|bingbot|yandexbot|duckduckbot|baiduspider|ahrefsbot|semrushbot|petalbot|applebot|gptbot|claude|chatgpt|perplexity|headlesschrome|puppeteer|playwright|phantomjs|selenium/i;

type TrackOptions = {
  venueId?: string;
  artistId?: string;
  eventId?: string;
  source?: string;
};

export async function trackPageView(opts: TrackOptions): Promise<void> {
  try {
    const h = await headers();
    const ua = h.get("user-agent") ?? "";
    if (!ua || BOT_PATTERNS.test(ua)) return;

    const sb = createServiceClient();
    await sb.from("page_views").insert({
      venue_id: opts.venueId ?? null,
      artist_id: opts.artistId ?? null,
      event_id: opts.eventId ?? null,
      source: opts.source ?? null,
    });
  } catch {
    // Swallow — analytics must never break a page
  }
}
