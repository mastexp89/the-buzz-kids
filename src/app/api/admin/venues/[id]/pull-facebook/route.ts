// Admin-only: scrape one venue's Facebook page on demand and ingest any
// new events. Same pipeline the nightly cron uses (via the shared
// scrape-facebook-ingest lib) — just triggered manually for a single
// venue from the venue's dashboard page.
//
// Use case: Dylan spots a gig poster on a venue's FB page that hasn't
// been picked up yet (or is from a venue not on the cron list, or has
// just been added). One click pulls events for THIS venue instead of
// waiting up to 14 days for the dormant-cooldown cron sweep.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { scrapeAndIngestVenue } from "@/lib/scrape-facebook-ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Apify scrape ~30s + AI extraction across 5 posts ~30s + DB inserts ~5s.
// Give the route ample headroom — admin will hit this rarely so the
// extended invocation cost doesn't matter.
export const maxDuration = 180;

const DEFAULT_MAX_POSTS = 5;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: venueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const apifyToken = process.env.APIFY_TOKEN;
  if (!apifyToken) {
    return NextResponse.json({ error: "APIFY_TOKEN env var missing" }, { status: 500 });
  }

  // Optional ?maxPosts=N override for tougher venues whose latest 5 posts
  // are all food specials and the real gig is further back.
  const url = new URL(req.url);
  const maxPosts = Math.max(
    1,
    Math.min(20, Number(url.searchParams.get("maxPosts") ?? DEFAULT_MAX_POSTS)),
  );

  const sb = createServiceClient();
  const { data: venue, error: vErr } = await sb
    .from("venues")
    .select("id, name, facebook, city_id, approved")
    .eq("id", venueId)
    .maybeSingle();
  if (vErr) return NextResponse.json({ error: `Lookup: ${vErr.message}` }, { status: 500 });
  if (!venue) return NextResponse.json({ error: "Venue not found" }, { status: 404 });
  if (!venue.facebook) {
    return NextResponse.json(
      { error: "This venue has no Facebook URL set. Add one in the venue edit form first." },
      { status: 400 },
    );
  }

  // Same genres prep as the cron — keep the AI extractor's options in sync.
  const { data: genreRows } = await sb.from("genres").select("id, slug, name").order("name");
  const availableGenres = (genreRows ?? []).map((g) => ({ slug: g.slug, name: g.name }));
  const genreSlugToId = new Map<string, string>();
  for (const g of genreRows ?? []) genreSlugToId.set(g.slug, g.id);

  const result = await scrapeAndIngestVenue({
    venue: {
      id: venue.id,
      name: venue.name,
      facebook: venue.facebook,
      city_id: venue.city_id,
    },
    apifyToken,
    maxPosts,
    availableGenres,
    genreSlugToId,
    supabase: sb,
  });

  // Bump last_facebook_scrape so the cron's cooldown doesn't immediately
  // re-pick this venue (would burn Apify credit).
  await sb.from("venues")
    .update({ last_facebook_scrape: new Date().toISOString() })
    .eq("id", venue.id);

  return NextResponse.json({
    ok: true,
    venue: venue.name,
    posts: result.posts,
    events: result.events,
    skipped: result.skipped,
    ...(result.error ? { error: result.error } : {}),
  });
}
