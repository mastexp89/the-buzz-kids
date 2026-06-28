"use server";

// Server actions for festival poster uploads.
//
// Two-phase flow (mirrors the venue poster-upload pattern):
//   1. extractFestivalPosterDrafts(festivalId, imageUrl)
//      - Run AI extraction on the poster
//      - For each event, look up the venue by name (using the same
//        normalisation the discover-venues tool uses)
//      - Return drafts annotated with the matched venue (or "no match")
//      - NO DB writes
//   2. publishFestivalPosterDrafts(festivalId, drafts)
//      - Insert events with festival_id set + matched venue_id
//      - Add the venue to festival_venues if not already linked
//      - Skip drafts without a matched venue (admin must edit + match
//        manually or create the venue first)
//
// Events get festival_id pointing at this festival, so the public RLS
// policy hides them until festival.published = true. Status stays
// "approved" — the visibility gate is the festival flag, not the
// approval status.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { extractEvents, type ExtractedEvent } from "@/lib/extraction";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: me } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") return null;
  return { userId: user.id };
}

function normaliseVenueName(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/^the\s+/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

export type FestivalDraftEvent = {
  // Identifier for the draft within this batch — used by the UI for
  // optimistic state. Not persisted.
  draftId: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  description: string;
  // The hint the AI pulled off the poster — what venue does this event
  // claim to be at? Editable in the UI before publish.
  venueHint: string | null;
  // After server-side matching: which venue (if any) this draft will
  // actually attach to. null when no match was found.
  matchedVenueId: string | null;
  matchedVenueName: string | null;
  // Genre slugs (used for genre linking on insert)
  genres: string[];
  // Artist names AI pulled off the poster (band / DJ / performer).
  // We resolve these to existing artists by name or create new
  // (approved=false) rows on publish, then link via event_artists.
  artists: string[];
  confidence: number;
};

export type ExtractFestivalDraftsResult =
  | { ok: true; drafts: FestivalDraftEvent[]; festivalName: string }
  | { error: string };

/**
 * Run AI extraction on a single uploaded poster URL. The festival's
 * date range is passed in as the "posted at" anchor so relative dates
 * ("Friday", "this weekend") resolve to the right week.
 */
export async function extractFestivalPosterDrafts(opts: {
  festivalId: string;
  imageUrl: string;
}): Promise<ExtractFestivalDraftsResult> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();

  const { data: festival } = await sb
    .from("festivals")
    .select("id, name, start_date, end_date")
    .eq("id", opts.festivalId)
    .maybeSingle();
  if (!festival) return { error: "Festival not found." };

  const { data: genreRows } = await sb
    .from("genres").select("slug, name").order("name");

  // Anchor the AI to the festival's start date so weekday references on
  // the poster ("Friday 7pm") resolve to the right Friday of the
  // festival weekend, not some Friday far away.
  const postedAt = new Date(festival.start_date + "T00:00:00Z").toISOString();

  let extraction;
  try {
    extraction = await extractEvents({
      // Pass the festival name as a venue placeholder — the AI uses this
      // for context but is told (per the prompt) to read the actual
      // venue off the poster as venue_hint.
      venueName: festival.name,
      postedAt,
      imageUrls: [opts.imageUrl],
      availableGenres: (genreRows ?? []).map((g) => ({ slug: g.slug, name: g.name })),
    });
  } catch (e: any) {
    return { error: `AI extraction failed: ${e?.message ?? "unknown error"}` };
  }

  // Pre-fetch the venue index for name matching. Pulls ALL approved
  // venues — a few hundred rows, well under any practical limit.
  const { data: venues } = await sb
    .from("venues")
    .select("id, name")
    .eq("approved", true);
  const venueIndex = new Map<string, { id: string; name: string }>();
  for (const v of venues ?? []) {
    venueIndex.set(normaliseVenueName(v.name as string), v as any);
  }

  const drafts: FestivalDraftEvent[] = extraction.events.map((e: ExtractedEvent, i: number) => {
    let matchedVenueId: string | null = null;
    let matchedVenueName: string | null = null;
    if (e.venue_hint) {
      const hit = venueIndex.get(normaliseVenueName(e.venue_hint));
      if (hit) {
        matchedVenueId = hit.id;
        matchedVenueName = hit.name;
      }
    }
    return {
      draftId: `${i}-${Date.now()}`,
      title: e.title,
      starts_at: e.starts_at,
      ends_at: e.ends_at,
      description: e.description ?? "",
      venueHint: e.venue_hint,
      matchedVenueId,
      matchedVenueName,
      genres: e.genres ?? [],
      artists: e.artists ?? [],
      confidence: e.confidence,
    };
  });

  return { ok: true, drafts, festivalName: festival.name };
}

export type CreateVenueResult =
  | { ok: true; venueId: string; venueName: string; citySlug: string | null }
  | { error: string };

/**
 * Quick-create a venue from the festival poster upload UI when the AI's
 * venue_hint doesn't match anything in the directory. Lands the venue
 * in the first active city (typically Dundee), marks it auto-imported
 * + approved so it shows up in the venue dropdown immediately, and
 * adds it to this festival's festival_venues.
 *
 * Admin can edit the venue's city / address / FB later via the normal
 * venue edit page — this just gets it into the DB so the poster's
 * event has a home.
 */
export async function createVenueForFestival(opts: {
  festivalId: string;
  name: string;
}): Promise<CreateVenueResult> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();

  const name = opts.name.trim();
  if (!name) return { error: "Venue name required." };
  if (name.length > 200) return { error: "Venue name too long (max 200)." };

  // De-dupe FIRST: a venue with the same normalised name already in the
  // directory should be reused, not duplicated. This prevents the
  // "5 posters mention 'Funky Wee Teapot', admin clicks Create 5 times,
  // ends up with 5 identical venue rows" failure mode.
  const targetNorm = normaliseVenueName(name);
  const { data: existing } = await sb
    .from("venues")
    .select("id, name, city:cities(slug)")
    .limit(500);
  for (const v of existing ?? []) {
    if (normaliseVenueName(((v as any).name ?? "") as string) === targetNorm) {
      const venueId = (v as any).id as string;
      // Still link to festival in case this is the first time admin's
      // pointing an event at this venue from this festival.
      await sb.from("festival_venues").upsert(
        [{ festival_id: opts.festivalId, venue_id: venueId }],
        { onConflict: "festival_id,venue_id", ignoreDuplicates: true },
      );
      return {
        ok: true,
        venueId,
        venueName: (v as any).name as string,
        citySlug: (v as any).city?.slug ?? null,
      };
    }
  }

  // No existing match — create a new venue. Pick a city: first active
  // city (typically Dundee). Admin can change later via venue edit.
  const { data: cityRow } = await sb
    .from("cities")
    .select("id, slug")
    .eq("active", true)
    .order("name")
    .limit(1)
    .maybeSingle();
  if (!cityRow) return { error: "No active cities configured." };

  const baseSlug = name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "venue";

  // Insert with collision-tolerant slug — same -2 / -3 pattern as the
  // other create paths.
  let slug = baseSlug;
  let created: { id: string } | null = null;
  for (let i = 0; i < 6; i++) {
    const { data, error } = await sb
      .from("venues")
      .insert({
        name,
        slug,
        city_id: cityRow.id,
        approved: true,
        auto_imported: true,
      })
      .select("id")
      .single();
    if (!error && data) {
      created = data as any;
      break;
    }
    if ((error as any)?.code === "23505") {
      slug = `${baseSlug}-${i + 2}`;
      continue;
    }
    return { error: (error as any)?.message ?? "Couldn't create venue." };
  }
  if (!created) return { error: "Couldn't generate a unique slug." };

  // Link to festival so the festival page reflects the new venue
  await sb.from("festival_venues").upsert(
    [{ festival_id: opts.festivalId, venue_id: created.id }],
    { onConflict: "festival_id,venue_id", ignoreDuplicates: true },
  );

  return {
    ok: true,
    venueId: created.id,
    venueName: name,
    citySlug: cityRow.slug,
  };
}

export type PublishFestivalDraftsResult =
  | { ok: true; created: number; skipped: number }
  | { error: string };

/**
 * Insert the admin-approved drafts as event rows tied to this festival.
 * Each event also adds its venue to festival_venues if it isn't there
 * yet, so the festival landing page reflects the new venue count.
 */
export async function publishFestivalPosterDrafts(opts: {
  festivalId: string;
  drafts: Array<{
    title: string;
    starts_at: string;
    ends_at: string | null;
    description: string;
    venueId: string;
    genres: string[];
    artists: string[];
  }>;
}): Promise<PublishFestivalDraftsResult> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  if (!opts.drafts?.length) return { error: "Nothing selected." };

  const sb = createServiceClient();

  // Sanity-check the festival exists.
  const { data: festival } = await sb
    .from("festivals")
    .select("id")
    .eq("id", opts.festivalId)
    .maybeSingle();
  if (!festival) return { error: "Festival not found." };

  // Build event rows. Status is "approved" — RLS hides them via
  // festival.published gate, no need to gate on status too.
  const rows = opts.drafts
    .filter((d) => d.title.trim() && d.starts_at && d.venueId)
    .map((d) => ({
      venue_id: d.venueId,
      title: d.title.trim().slice(0, 200),
      description: (d.description ?? "").slice(0, 2000),
      start_time: d.starts_at,
      end_time: d.ends_at,
      status: "approved",
      festival_id: opts.festivalId,
    }));
  const skipped = opts.drafts.length - rows.length;
  if (rows.length === 0) {
    return { error: "No drafts had a venue match. Pick a venue for each before publishing." };
  }

  const { data: created, error } = await sb
    .from("events")
    .insert(rows)
    .select("id, venue_id");
  if (error) return { error: error.message };

  // Genre links
  const allGenreSlugs = Array.from(
    new Set(opts.drafts.flatMap((d) => d.genres ?? [])),
  );
  if (allGenreSlugs.length > 0 && created) {
    const { data: gRows } = await sb
      .from("genres")
      .select("id, slug")
      .in("slug", allGenreSlugs);
    const slugToId = new Map<string, string>(
      (gRows ?? []).map((g: any) => [g.slug, g.id]),
    );
    const filtered = opts.drafts.filter((d) => d.title.trim() && d.starts_at && d.venueId);
    const links: Array<{ event_id: string; genre_id: string }> = [];
    for (let i = 0; i < created.length; i++) {
      const slugs = filtered[i]?.genres ?? [];
      for (const s of slugs) {
        const gid = slugToId.get(s);
        if (gid) links.push({ event_id: created[i].id as string, genre_id: gid });
      }
    }
    if (links.length > 0) {
      await sb.from("event_genres").insert(links);
    }
  }

  // Link each unique venue to the festival (idempotent — primary key on
  // festival_venues is (festival_id, venue_id) so the upsert is a no-op
  // for venues already linked).
  const uniqueVenueIds = Array.from(new Set(rows.map((r) => r.venue_id)));
  if (uniqueVenueIds.length > 0) {
    await sb.from("festival_venues").upsert(
      uniqueVenueIds.map((venue_id) => ({
        festival_id: opts.festivalId,
        venue_id,
      })),
      { onConflict: "festival_id,venue_id", ignoreDuplicates: true },
    );
  }

  // ---------- Resolve + link artists ----------
  // For each draft with artists, find each one by case-insensitive name
  // match (existing artist) or create a fresh row (approved=true so the
  // festival lineup can show them right away). Then upsert the
  // event_artists junction so the lineup query returns them.
  //
  // This is the bit that was missing — events were being created but
  // the lineup tab on the festival landing page stayed empty because
  // no event_artists rows ever got written.
  const filtered = opts.drafts.filter((d) => d.title.trim() && d.starts_at && d.venueId);
  // Per-batch cache of name → artist_id so we don't re-query for an
  // artist appearing on multiple posters in the same upload.
  const artistIdByNorm = new Map<string, string>();
  const slugifyArtist = (n: string) =>
    n.toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "artist";
  const normArtist = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "");

  for (let i = 0; i < (created ?? []).length; i++) {
    const eventId = created![i].id as string;
    const draft = filtered[i];
    if (!draft) continue;
    const names = (draft.artists ?? [])
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 80);
    if (names.length === 0) continue;

    for (const name of names) {
      const key = normArtist(name);
      let aid = artistIdByNorm.get(key) ?? null;
      if (!aid) {
        // Try case-insensitive exact name match
        const { data: existing } = await sb
          .from("artists")
          .select("id")
          .ilike("name", name)
          .maybeSingle();
        if (existing) aid = (existing as any).id;
      }
      if (!aid) {
        // Create a new artist with collision-tolerant slug
        const base = slugifyArtist(name);
        let slug = base;
        for (let j = 0; j < 5; j++) {
          const { data: created, error: aErr } = await sb
            .from("artists")
            .insert({ name, slug, approved: true })
            .select("id")
            .single();
          if (!aErr && created) {
            aid = (created as any).id;
            break;
          }
          if ((aErr as any)?.code === "23505") {
            slug = `${base}-${j + 2}`;
            continue;
          }
          break;
        }
      }
      if (aid) {
        artistIdByNorm.set(key, aid);
        await sb
          .from("event_artists")
          .upsert([{ event_id: eventId, artist_id: aid }], {
            onConflict: "event_id,artist_id",
            ignoreDuplicates: true,
          });
      }
    }
  }

  revalidatePath(`/admin/festivals/${opts.festivalId}`);
  return { ok: true, created: rows.length, skipped };
}
