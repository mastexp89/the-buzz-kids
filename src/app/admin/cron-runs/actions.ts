"use server";

// Daily summary of what each cron job produced — computed on the fly from
// existing tables (no separate cron_runs log table needed). Covers:
//   - FB scraper: venues scraped, events created, cover photos populated
//   - Dedupe: events deleted via the daily cleanup
//   - Site / quick imports & manual entries shown for context
//
// Date range: last 30 days by default. Days with zero activity still appear
// so it's obvious if a cron didn't run.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return null;
  return { userId: user.id };
}

export type CronDayStats = {
  date: string; // YYYY-MM-DD
  weekday: string;
  // FB cron output
  fbVenuesScraped: number;     // venues with last_facebook_scrape on this day
  fbEventsCreated: number;     // events created via 'facebook' source
  fbEventsSkipped: number;     // events extracted but caught by the dedup
                                // filter (existing row matches). Sourced from
                                // sql/058 fb_scrape_venue_runs log table.
  fbErrors: number;             // per-venue extraction errors (Anthropic
                                // failures, Apify failures, etc.). Same source.
  coverPhotosPopulated: number; // cover_photo_url filled today
  // Other event sources (for context — these aren't crons, but useful to see)
  manualEventsCreated: number;
  // Dedupe — we can't see what was deleted (no soft-delete) but events
  // marked rejected on this day are a proxy
  eventsRejected: number;
  // Was the FB cron expected today? (Mon=1 / Thu=4 in vercel.json)
  fbExpected: boolean;
  // Any events created at all
  totalEventsCreated: number;
};

export async function getCronDailyStats(days = 30): Promise<CronDayStats[]> {
  if (!(await requireAdmin())) return [];
  const sb = createServiceClient();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Build a map of day → stats, prefilled with zero counts so missing days show up
  const out = new Map<string, CronDayStats>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const wd = d.getUTCDay(); // 0=Sun
    out.set(iso, {
      date: iso,
      weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][wd],
      fbVenuesScraped: 0,
      fbEventsCreated: 0,
      fbEventsSkipped: 0,
      fbErrors: 0,
      coverPhotosPopulated: 0,
      manualEventsCreated: 0,
      eventsRejected: 0,
      fbExpected: wd === 1 || wd === 4, // Mon + Thu
      totalEventsCreated: 0,
    });
  }

  const fromIso = `${[...out.keys()][0]}T00:00:00Z`;

  // 1. Events created per day, split by source
  const { data: events } = await sb
    .from("events")
    .select("created_at, auto_imported_from, status")
    .gte("created_at", fromIso);
  for (const e of events ?? []) {
    const day = (e.created_at ?? "").slice(0, 10);
    const row = out.get(day);
    if (!row) continue;
    row.totalEventsCreated++;
    if (e.auto_imported_from === "facebook") row.fbEventsCreated++;
    else if (e.auto_imported_from === "manual_upload" || !e.auto_imported_from) row.manualEventsCreated++;
    if (e.status === "rejected") row.eventsRejected++;
  }

  // 2. Venues scraped per day (last_facebook_scrape ≈ when the FB cron processed it)
  const { data: venues } = await sb
    .from("venues")
    .select("last_facebook_scrape, cover_photo_last_attempt, cover_photo_url")
    .or(`last_facebook_scrape.gte.${fromIso},cover_photo_last_attempt.gte.${fromIso}`);
  for (const v of venues ?? []) {
    if (v.last_facebook_scrape) {
      const day = v.last_facebook_scrape.slice(0, 10);
      const row = out.get(day);
      if (row) row.fbVenuesScraped++;
    }
    if (v.cover_photo_last_attempt && v.cover_photo_url) {
      const day = v.cover_photo_last_attempt.slice(0, 10);
      const row = out.get(day);
      if (row) row.coverPhotosPopulated++;
    }
  }

  // 3. Per-venue run log (sql/058) — gives us Skipped + Errors columns.
  // The table may not exist yet on older deploys; in that case Supabase
  // returns an error and we silently skip the rollup (the columns will
  // just stay at 0). Future-proofed.
  try {
    const { data: runs, error: runErr } = await sb
      .from("fb_scrape_venue_runs")
      .select("ran_at, events_skipped, error")
      .gte("ran_at", fromIso);
    if (!runErr) {
      for (const r of runs ?? []) {
        const day = (r.ran_at ?? "").slice(0, 10);
        const row = out.get(day);
        if (!row) continue;
        row.fbEventsSkipped += (r.events_skipped as number) ?? 0;
        if (r.error) row.fbErrors++;
      }
    }
  } catch {
    // Table missing pre-migration — stats stay 0, page still renders.
  }

  // Newest first
  return Array.from(out.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
}

export type FbScrapeBudget = {
  totalWithFb: number;          // venues that have a FB URL
  active: number;                // had an event imported in last 90 days
  dormant: number;               // 90+ days quiet, or never had an event
  neverScraped: number;          // count of venues with last_facebook_scrape IS NULL
  // Apify volume estimates per month — what the cron would consume at
  // each tier, assuming Mon+Thu scrapes (8 per month) for active venues
  // and ~2x/month (14d cooldown) for dormant ones. Useful for budgeting.
  activeScrapesPerMonth: number;
  dormantScrapesPerMonth: number;
  totalScrapesPerMonth: number;
  // How many scrapes would happen WITHOUT dormancy logic (Mon+Thu = 8x)
  scrapesPerMonthIfAllActive: number;
};

/**
 * Roll up dormant-venue stats for the cron-runs dashboard. Shows the
 * admin how many venues are active vs dormant, and what the dormancy
 * filter saves in monthly Apify calls. NULL-safe against pre-sql/059
 * deploys: if the column doesn't exist yet, everything reports as
 * active (matching the old behaviour).
 */
export async function getFbScrapeBudget(): Promise<FbScrapeBudget | null> {
  if (!(await requireAdmin())) return null;
  const sb = createServiceClient();
  const dormantCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const baseQuery = sb
    .from("venues")
    .select("id", { count: "exact", head: true })
    .not("facebook", "is", null)
    .eq("approved", true);

  // Total venues with a FB URL
  const { count: totalCount } = await baseQuery;

  // Active venues: had an event imported in last 90 days
  let active = 0;
  let dormantOnly = 0;
  try {
    const { count: activeCount } = await sb
      .from("venues")
      .select("id", { count: "exact", head: true })
      .not("facebook", "is", null)
      .eq("approved", true)
      .gte("last_event_imported_at", dormantCutoff);
    active = activeCount ?? 0;

    // Explicitly-dormant venues: have a last_event_imported_at but it's old
    const { count: dormantWithHistory } = await sb
      .from("venues")
      .select("id", { count: "exact", head: true })
      .not("facebook", "is", null)
      .eq("approved", true)
      .lt("last_event_imported_at", dormantCutoff);
    dormantOnly = dormantWithHistory ?? 0;
  } catch {
    // Pre-sql/059 — column doesn't exist, treat everything as active so
    // the dashboard doesn't claim a saving that isn't happening.
    active = totalCount ?? 0;
    dormantOnly = 0;
  }

  // Anything not active and not in dormantOnly = never had an event at all.
  const totalWithFb = totalCount ?? 0;
  const neverHadEvent = Math.max(0, totalWithFb - active - dormantOnly);
  // Combined dormant pool: explicit-dormant + never-had-event.
  const dormant = dormantOnly + neverHadEvent;

  // Never scraped: separate signal — venues without last_facebook_scrape.
  const { count: neverScrapedCount } = await sb
    .from("venues")
    .select("id", { count: "exact", head: true })
    .not("facebook", "is", null)
    .eq("approved", true)
    .is("last_facebook_scrape", null);
  const neverScraped = neverScrapedCount ?? 0;

  // Volume: cron runs Mon + Thu = 8 days/month per active venue
  // (12h cooldown means each scheduled cron day = ~1 scrape per venue).
  // Dormant venues with 14d cooldown ≈ 2.14 scrapes/month.
  const activeScrapesPerMonth = active * 8;
  const dormantScrapesPerMonth = Math.round(dormant * (30 / 14));
  const totalScrapesPerMonth = activeScrapesPerMonth + dormantScrapesPerMonth;
  // Comparison: what we'd do if the dormancy tier didn't exist
  const scrapesPerMonthIfAllActive = totalWithFb * 8;

  return {
    totalWithFb,
    active,
    dormant,
    neverScraped,
    activeScrapesPerMonth,
    dormantScrapesPerMonth,
    totalScrapesPerMonth,
    scrapesPerMonthIfAllActive,
  };
}

// Trigger one of the cron routes from the admin UI without the admin needing
// to know CRON_SECRET. Server-side has access to process.env.CRON_SECRET, so
// we can construct the same Bearer header the Vercel scheduler would.
//
// We require admin auth via Supabase cookie before firing — the cron secret
// never leaves the server.
async function triggerCronRoute(path: string): Promise<{ ok: true; body: string } | { error: string }> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };

  const secret = process.env.CRON_SECRET;
  if (!secret) return { error: "CRON_SECRET env var isn't set on the server." };

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.thebuzzguide.co.uk";
  const url = `${siteUrl}${path}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
      // Don't cache — every click is a fresh trigger.
      cache: "no-store",
    });
    const body = await res.text();
    if (!res.ok) {
      return { error: `Cron route returned ${res.status}: ${body.slice(0, 400)}` };
    }
    return { ok: true, body };
  } catch (e: any) {
    return { error: `Couldn't reach the cron route: ${e?.message ?? e}` };
  }
}

/**
 * Manually trigger the daily dedupe cron.
 * Optional `dry: true` runs in preview mode (no writes).
 */
export async function runDedupeNow(opts: { dry?: boolean } = {}) {
  const path = `/api/cron/dedupe-events${opts.dry ? "?dry=1" : ""}`;
  return triggerCronRoute(path);
}

/**
 * Manually trigger the FB scraper cron. Self-chains on Vercel so a single
 * call kicks off the whole sweep across every venue with a FB URL set.
 *
 * Pass `citySlug` to scope the sweep to a single region (e.g. "angus")
 * — handy when you've just bulk-added a region's venues and don't want
 * to re-scrape everywhere.
 */
export async function runFacebookScrapeNow(opts: { citySlug?: string; force?: boolean } = {}) {
  const params = new URLSearchParams();
  if (opts.citySlug) params.set("city", opts.citySlug);
  if (opts.force) params.set("force", "1");
  const qs = params.toString();
  const path = `/api/cron/scrape-facebook${qs ? `?${qs}` : ""}`;
  return triggerCronRoute(path);
}

/**
 * Manually trigger the website event scraper cron. Unlike the FB scrape it
 * does NOT self-chain — one call processes one batch (default 6 venues) and
 * returns, so the review queue fills at a bounded rate. Click again (or pass
 * a bigger `batch`) to process more.
 *
 * Pass `citySlug` to scope to one region, `force` to ignore the 30-day
 * cooldown, `dry` to preview without writing.
 */
export async function runWebsiteScrapeNow(
  opts: { citySlug?: string; force?: boolean; dry?: boolean; batch?: number } = {},
) {
  const params = new URLSearchParams();
  if (opts.citySlug) params.set("city", opts.citySlug);
  if (opts.force) params.set("force", "1");
  if (opts.dry) params.set("dry", "1");
  if (opts.batch) params.set("batch", String(opts.batch));
  const qs = params.toString();
  const path = `/api/cron/scrape-websites${qs ? `?${qs}` : ""}`;
  return triggerCronRoute(path);
}

export type FacebookCronProgress = {
  ok: true;
  done: number;
  total: number;
  remaining: number;
  pct: number;
  eventsCreatedToday: number;
  coverPhotosPopulatedToday: number;
  lastFiveScraped: Array<{ name: string; at: string | null }>;
  nextFiveQueued: Array<{ name: string; lastScraped: string | null }>;
};

/**
 * Poll-friendly progress check for the FB scrape cron. Calls the same
 * /progress endpoint the cron uses internally, but routed through a
 * server action so the CRON_SECRET stays server-side and the client
 * just needs to hit the action via the normal admin auth.
 */
export async function getFacebookCronProgress(opts: { citySlug?: string } = {}): Promise<
  { error: string } | FacebookCronProgress
> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };

  const secret = process.env.CRON_SECRET;
  if (!secret) return { error: "CRON_SECRET env var isn't set on the server." };

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.thebuzzguide.co.uk";
  const path = opts.citySlug
    ? `/api/cron/scrape-facebook/progress?city=${encodeURIComponent(opts.citySlug)}`
    : "/api/cron/scrape-facebook/progress";

  try {
    const res = await fetch(`${siteUrl}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      return { error: `Progress route returned ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = await res.json();
    return {
      ok: true,
      done: json?.progress?.done ?? 0,
      total: json?.progress?.total ?? 0,
      remaining: json?.progress?.remaining ?? 0,
      pct: json?.progress?.pct ?? 0,
      eventsCreatedToday: json?.eventsCreatedToday ?? 0,
      coverPhotosPopulatedToday: json?.coverPhotosPopulatedToday ?? 0,
      lastFiveScraped: json?.lastFiveScraped ?? [],
      nextFiveQueued: json?.nextFiveQueued ?? [],
    };
  } catch (e: any) {
    return { error: `Couldn't reach progress route: ${e?.message ?? e}` };
  }
}
