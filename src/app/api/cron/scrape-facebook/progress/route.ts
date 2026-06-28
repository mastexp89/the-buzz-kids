// Read-only progress check for the FB scrape cron.
// Returns: how many venues have been scraped today, how many remain, and
// the count of events created today via Facebook.
//
// Same auth as the cron itself.
//
// Example:
//   curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/scrape-facebook/progress

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const sb = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const todayStartIso = `${today}T00:00:00Z`;

  // Optional ?city=<slug> — scopes counts to that city. Matches the
  // ?city= param on the main scrape route so the progress numbers line
  // up with the actual sweep.
  const url = new URL(req.url);
  const cityFilterSlug = url.searchParams.get("city");
  let cityIdFilter: string | null = null;
  if (cityFilterSlug) {
    const { data: cityRow } = await sb
      .from("cities")
      .select("id")
      .eq("slug", cityFilterSlug)
      .maybeSingle();
    if (cityRow) cityIdFilter = cityRow.id;
  }

  // Total venues with a FB URL (optionally city-scoped)
  const totalBase = sb
    .from("venues")
    .select("id", { count: "exact", head: true })
    .not("facebook", "is", null)
    .eq("approved", true);
  const { count: totalWithFb } = await (cityIdFilter
    ? totalBase.eq("city_id", cityIdFilter)
    : totalBase);

  // Scraped today (optionally city-scoped)
  const scrapedTodayBase = sb
    .from("venues")
    .select("id", { count: "exact", head: true })
    .not("facebook", "is", null)
    .eq("approved", true)
    .gte("last_facebook_scrape", todayStartIso);
  const { count: scrapedToday } = await (cityIdFilter
    ? scrapedTodayBase.eq("city_id", cityIdFilter)
    : scrapedTodayBase);

  // Events created today via Facebook
  const { count: eventsToday } = await sb
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("auto_imported_from", "facebook")
    .gte("created_at", todayStartIso);

  // Cover photos populated today
  const { count: coverPhotosToday } = await sb
    .from("venues")
    .select("id", { count: "exact", head: true })
    .not("cover_photo_url", "is", null)
    .gte("cover_photo_last_attempt", todayStartIso);

  // Most recently scraped — gives a sanity check that things are still
  // moving. City-filtered when scoped, so the names match the sweep the
  // admin's actually watching.
  const lastScrapedBase = sb
    .from("venues")
    .select("name, last_facebook_scrape")
    .not("last_facebook_scrape", "is", null)
    .order("last_facebook_scrape", { ascending: false })
    .limit(5);
  const { data: lastScraped } = await (cityIdFilter
    ? lastScrapedBase.eq("city_id", cityIdFilter)
    : lastScrapedBase);

  // Oldest pending — what's still queued for today (also city-filtered).
  const oldestPendingBase = sb
    .from("venues")
    .select("name, last_facebook_scrape")
    .not("facebook", "is", null)
    .eq("approved", true)
    .or(`last_facebook_scrape.is.null,last_facebook_scrape.lt.${todayStartIso}`)
    .order("last_facebook_scrape", { ascending: true, nullsFirst: true })
    .limit(5);
  const { data: oldestPending } = await (cityIdFilter
    ? oldestPendingBase.eq("city_id", cityIdFilter)
    : oldestPendingBase);

  const total = totalWithFb ?? 0;
  const done = scrapedToday ?? 0;
  const remaining = Math.max(0, total - done);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return NextResponse.json({
    ok: true,
    today,
    progress: {
      done,
      total,
      remaining,
      pct,
    },
    eventsCreatedToday: eventsToday ?? 0,
    coverPhotosPopulatedToday: coverPhotosToday ?? 0,
    lastFiveScraped: (lastScraped ?? []).map((v) => ({ name: v.name, at: v.last_facebook_scrape })),
    nextFiveQueued: (oldestPending ?? []).map((v) => ({ name: v.name, lastScraped: v.last_facebook_scrape })),
  });
}
