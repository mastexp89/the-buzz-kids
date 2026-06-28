// Sponsor click redirect. The banner anchor points here instead of the
// advertiser's URL directly so we can record the click before redirecting
// out. Returns a 302 to the sponsor's link_url; bumps click_count via SQL
// helper (atomic increment).
//
// Bots are filtered by user-agent so we don't inflate counters with crawlers.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const BOT_PATTERNS =
  /bot\b|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|slackbot|discordbot|linkedinbot|twitterbot|skypeuripreview|googlebot|bingbot|yandexbot|duckduckbot|baiduspider|ahrefsbot|semrushbot|petalbot|applebot|gptbot|claude|chatgpt|perplexity|headlesschrome|puppeteer|playwright|phantomjs|selenium/i;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sb = createServiceClient();

  // Look up the sponsor + check it's live.
  const { data: sponsor } = await sb
    .from("sponsors")
    .select("link_url, status, starts_at, ends_at")
    .eq("id", id)
    .maybeSingle();

  if (!sponsor) {
    // Sponsor doesn't exist (deleted, bad ID). Send them home.
    return NextResponse.redirect(new URL("/", req.url));
  }

  // Bump click_count unless the request is from a known bot/crawler.
  // We AWAIT so the count is guaranteed to land before the redirect — the
  // call is a single tiny SQL UPDATE, ~10ms, not worth the risk of losing
  // it to a dangling promise.
  const ua = req.headers.get("user-agent") ?? "";
  if (ua && !BOT_PATTERNS.test(ua)) {
    await sb.rpc("increment_sponsor_click", { sponsor_id: id });
  }

  return NextResponse.redirect(sponsor.link_url, 302);
}
