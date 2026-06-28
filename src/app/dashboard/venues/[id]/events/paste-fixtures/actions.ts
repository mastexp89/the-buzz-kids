"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { extractEvents } from "@/lib/extraction";

async function ownsVenue(venueId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: venue } = await supabase
    .from("venues")
    .select("id, owner_id")
    .eq("id", venueId)
    .maybeSingle();
  if (!venue) return null;
  if (venue.owner_id !== user.id) {
    const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (me?.role !== "admin") return null;
  }
  return { userId: user.id };
}

export type ParsedFixtureEvent = {
  title: string;
  starts_at: string;
  ends_at: string | null;
  description: string;
  type: string;
  confidence: number;
  genres: string[];
};

export type ParseFixturesResult =
  | { ok: true; events: ParsedFixtureEvent[] }
  | { error: string };

/**
 * Call the AI extractor on pasted fixtures text and return draft events
 * for the venue owner to review + approve. Does NOT write to the DB —
 * the caller hands back an edited list to bulkCreateFromFixtures.
 *
 * The AI prompt already knows to aggregate same-day sports screenings
 * (see SPORTS SCREENING AGGREGATION in lib/extraction.ts), so a 4-day
 * fixtures list typically comes back as 4 events, not 20.
 */
export async function parseFixturesText(
  venueId: string,
  text: string,
): Promise<ParseFixturesResult> {
  const ctx = await ownsVenue(venueId);
  if (!ctx) return { error: "Not authorised." };
  const trimmed = (text ?? "").trim();
  if (trimmed.length === 0) return { error: "Paste some fixtures text first." };
  if (trimmed.length > 20000) {
    return { error: "Text is too long (max 20,000 characters)." };
  }

  const sb = createServiceClient();
  const [{ data: venue }, { data: genreRows }] = await Promise.all([
    sb.from("venues").select("name").eq("id", venueId).maybeSingle(),
    sb.from("genres").select("slug, name").order("name"),
  ]);
  if (!venue) return { error: "Venue not found." };

  try {
    const res = await extractEvents({
      venueName: venue.name,
      // Anchor relative dates ("Monday 11th", "tomorrow") to NOW.
      postedAt: new Date().toISOString(),
      textContent: trimmed,
      imageUrls: [],
      availableGenres: (genreRows ?? []).map((g: any) => ({
        slug: g.slug,
        name: g.name,
      })),
    });

    return {
      ok: true,
      events: res.events.map((e) => ({
        title: e.title,
        starts_at: e.starts_at,
        ends_at: e.ends_at,
        description: e.description ?? "",
        type: e.type,
        confidence: e.confidence,
        genres: e.genres ?? [],
      })),
    };
  } catch (e: any) {
    return { error: `AI extraction failed: ${e?.message ?? "unknown error"}` };
  }
}

export type BulkCreateResult =
  | { ok: true; created: number; replacedAggregations: number }
  | { error: string };

// Recognises the AI sports-day aggregation title shape, e.g.
// "LIVE SPORTS — 7 MATCHES", "Live Sports (8 matches)", "Live Sports - 13 matches".
// We use this both for detecting incoming rows AND for finding existing rows
// to replace, so the two stay in lockstep.
function looksLikeFixtureAggregation(title: string): boolean {
  const t = String(title ?? "").trim();
  return /^live\s*sports\b/i.test(t)
    && /\b\d+\s*(match(?:es)?|games?|fixtures?)\b/i.test(t);
}

function londonDayOf(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

/**
 * Insert a vetted list of fixtures-derived events. Each event becomes a
 * status='approved' row at the venue (venue-owner-created events go
 * straight live, matching the existing single-event create flow). Genre
 * links are added when the slug exists in the genres table.
 *
 * Sports-day aggregations ("LIVE SPORTS — N MATCHES") are special: re-running
 * the AI tool typically produces a slightly different N (different source
 * snapshot). To stop the venue page accumulating "LIVE SPORTS — 7 MATCHES"
 * and "LIVE SPORTS — 8 MATCHES" side-by-side for the same day, we delete any
 * existing aggregation rows at the same venue+London-day before inserting
 * the new ones. Non-aggregation events (pub quizzes, named gigs, etc.) are
 * never touched by this replace step.
 */
export async function bulkCreateFromFixtures(
  venueId: string,
  events: Array<{
    title: string;
    starts_at: string;
    ends_at: string | null;
    description: string;
    genres?: string[];
  }>,
): Promise<BulkCreateResult> {
  const ctx = await ownsVenue(venueId);
  if (!ctx) return { error: "Not authorised." };
  if (!events?.length) return { error: "No events selected." };
  if (events.length > 50) return { error: "Too many events at once (max 50)." };

  const sb = createServiceClient();

  // Validate each event has the bare minimum (title + parseable start_time).
  const rows: any[] = [];
  for (const e of events) {
    const title = (e.title ?? "").trim();
    if (!title) continue;
    if (!e.starts_at) continue;
    const t = new Date(e.starts_at);
    if (Number.isNaN(t.getTime())) continue;
    rows.push({
      venue_id: venueId,
      title: title.slice(0, 200),
      start_time: e.starts_at,
      end_time: e.ends_at,
      description: (e.description ?? "").slice(0, 2000),
      status: "approved",
    });
  }
  if (rows.length === 0) {
    return { error: "None of the parsed events were valid." };
  }

  // Replace, don't append, for sports-day aggregations.
  let replacedAggregations = 0;
  const aggregationDays = new Set<string>();
  for (const r of rows) {
    if (!looksLikeFixtureAggregation(r.title)) continue;
    const day = londonDayOf(r.start_time);
    if (day) aggregationDays.add(day);
  }
  if (aggregationDays.size > 0) {
    // Pull this venue's upcoming aggregation rows (small set per venue) and
    // filter by Europe/London day in JS so DST shifts don't trip us up.
    const horizon = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await sb
      .from("events")
      .select("id, title, start_time")
      .eq("venue_id", venueId)
      .gte("start_time", past)
      .lte("start_time", horizon)
      .ilike("title", "live sports%");
    const toDelete: string[] = [];
    for (const ev of existing ?? []) {
      if (!looksLikeFixtureAggregation(ev.title as string)) continue;
      const day = londonDayOf(ev.start_time as string);
      if (day && aggregationDays.has(day)) toDelete.push(ev.id as string);
    }
    if (toDelete.length > 0) {
      const { count } = await sb
        .from("events")
        .delete({ count: "exact" })
        .in("id", toDelete);
      replacedAggregations = count ?? toDelete.length;
    }
  }

  const { data: created, error } = await sb
    .from("events")
    .insert(rows)
    .select("id");
  if (error) return { error: error.message };

  // Link genres for each created event when slugs match the genres table.
  // Best-effort: failures here don't fail the create.
  const allSlugs = Array.from(new Set(events.flatMap((e) => e.genres ?? [])));
  if (allSlugs.length > 0 && created) {
    const { data: genreRows } = await sb
      .from("genres")
      .select("id, slug")
      .in("slug", allSlugs);
    const slugToId = new Map<string, string>(
      (genreRows ?? []).map((g: any) => [g.slug, g.id]),
    );
    const links: Array<{ event_id: string; genre_id: string }> = [];
    for (let i = 0; i < created.length; i++) {
      const slugs = events[i]?.genres ?? [];
      for (const s of slugs) {
        const gid = slugToId.get(s);
        if (gid) links.push({ event_id: created[i].id, genre_id: gid });
      }
    }
    if (links.length > 0) await sb.from("event_genres").insert(links);
  }

  revalidatePath(`/dashboard/venues/${venueId}`);
  return { ok: true, created: rows.length, replacedAggregations };
}
