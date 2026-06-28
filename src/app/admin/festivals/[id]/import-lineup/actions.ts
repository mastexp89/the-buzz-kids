"use server";

// Bulk import a festival's full lineup from one or more poster images.
//
// Flow:
//   1. Admin uploads images (handled client-side via Supabase Storage,
//      then sends us the public URLs).
//   2. extractFestivalLineupAction calls Claude vision with the festival's
//      participating venues as context, gets back an array of slots
//      (venue / artist / day / startTime / endTime / stage).
//   3. We fuzzy-match each slot's venue name against the festival's
//      linked venues; matched slots get a venueId, unmatched ones are
//      flagged so the admin can pick a venue manually in the UI.
//   4. The UI shows the preview table; admin ticks what to keep,
//      adjusts anything wrong, then publishes.
//   5. publishFestivalLineupAction creates a real `events` row at each
//      chosen venue plus the artist link, with status='approved' and
//      auto_imported_from='festival_lineup'.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { extractFestivalLineup, type ExtractedLineupSlot } from "@/lib/extraction";
import { slugify } from "@/lib/utils";
import { revalidatePath } from "next/cache";

// Parse a wall-clock "YYYY-MM-DDTHH:mm" string as Europe/London local
// time and return the UTC ISO string. Mirrors the helper added in
// claude/fix-event-time-timezone — duplicated here so this PR doesn't
// depend on that one merging first. When both have landed, deduplicate
// in a quick follow-up.
function londonWallClockToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const [, Y, Mo, D, h, mi, se] = m;
  const asUtc = Date.UTC(+Y, +Mo - 1, +D, +h, +mi, se ? +se : 0);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    timeZoneName: "longOffset",
  }).formatToParts(new Date(asUtc));
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const off = /GMT([+-])(\d{2}):(\d{2})/.exec(tz);
  const offsetMin = off ? (off[1] === "+" ? 1 : -1) * (+off[2] * 60 + +off[3]) : 0;
  return new Date(asUtc - offsetMin * 60_000).toISOString();
}

// Add `mins` to an "HH:mm" string. Wraps past 23:59 → next-day clock
// time (caller must compensate by advancing the date). Returns just
// the new HH:mm; the day-shift flag is returned via the second tuple
// element so callers can decide what to do with it.
function addMinutesToHHMM(hhmm: string, mins: number): { time: string; dayOffset: number } {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + mins;
  const dayOffset = Math.floor(total / (24 * 60));
  const remainder = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = Math.floor(remainder / 60);
  const mm = remainder % 60;
  return {
    time: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
    dayOffset,
  };
}

// Day-of-week key matching the existing opening_hours_json shape
// (sun/mon/tue/...). Midday-anchored so DST transitions can't push
// the date into the wrong day.
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
function ymdToDayKey(ymd: string): typeof DAY_KEYS[number] {
  const d = new Date(ymd + "T12:00:00");
  if (Number.isNaN(d.getTime())) return "mon";
  return DAY_KEYS[d.getDay()];
}

// Add N days to a YYYY-MM-DD string and return the new YYYY-MM-DD.
// Used when an inferred end time wraps past midnight (e.g. 23:00 set
// running until 01:00 means end_time is on day+1).
function addDaysToYmd(ymd: string, days: number): string {
  const d = new Date(ymd + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Default duration (mins) for the LAST act of the day at a venue when
// no opening_hours_json close time is available. Set to a sensible
// festival headliner slot — long enough to span 9pm headliners running
// to 10:30, short enough that a 4pm afternoon act doesn't spill into
// dinner. Per-festival override could come later if needed.
const DEFAULT_LAST_ACT_MINS = 90;

// Sort + chain pass that fills missing endTime on drafts. Mutates the
// drafts in place — the publish loop's `for (const draft of drafts)`
// sees the inferred values.
//
// Grouping key: (venueId OR normalised create-name) + day. So two
// drafts with createVenueName "doghouse" and "Doghouse " group into
// the same venue even though the venue doesn't have an id yet.
//
// Rule per group:
//   - Acts in chronological order
//   - If endTime exists (Claude found it on the poster), leave it
//   - Otherwise:
//       not-last act → endTime = next act's startTime
//       last act     → venue close time for that day-of-week, or
//                      startTime + DEFAULT_LAST_ACT_MINS as fallback
function inferMissingEndTimes(
  drafts: PublishDraft[],
  venueHoursById: Map<string, any>,
): void {
  type DayHours = { closed?: boolean; open?: string; close?: string };
  type OpeningHoursJson = Partial<Record<typeof DAY_KEYS[number], DayHours>>;

  // Group drafts by venue + day. Using a string key for createVenueName
  // ensures two rows pointing at the same brand-new venue chain
  // together.
  const groups = new Map<string, PublishDraft[]>();
  for (const d of drafts) {
    const venueKey = d.venueId
      ? `id:${d.venueId}`
      : `new:${(d.createVenueName ?? "").trim().toLowerCase()}`;
    const key = `${venueKey}|${d.day}`;
    const arr = groups.get(key) ?? [];
    arr.push(d);
    groups.set(key, arr);
  }

  for (const group of groups.values()) {
    group.sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 0; i < group.length; i++) {
      const act = group[i];
      if (act.endTime) continue; // respect explicit poster times

      if (i < group.length - 1) {
        // Chain to next act's start.
        const nextStart = group[i + 1].startTime;
        // Defensive: if next act's start somehow equals or precedes
        // this act's start (shouldn't happen post-sort, but Claude
        // could emit "10:00" then "10:00" for the same venue), skip
        // chaining and fall through to the +90 default below.
        if (nextStart > act.startTime) {
          act.endTime = nextStart;
          continue;
        }
      }

      // Last act of the day at this venue, OR a fall-through from the
      // edge case above. Try venue's opening_hours close time for the
      // matching weekday; fall back to start + DEFAULT_LAST_ACT_MINS.
      let endHHMM: string | null = null;
      let dayOffset = 0;
      if (act.venueId) {
        const hours = venueHoursById.get(act.venueId) as OpeningHoursJson | null;
        const dow = ymdToDayKey(act.day);
        const dayHours = hours?.[dow];
        if (dayHours && !dayHours.closed && dayHours.close) {
          endHHMM = dayHours.close;
          // Venue close times can be after midnight (e.g. "01:00" for
          // a 1am closing on a Saturday). If the close is earlier in
          // HH:mm space than start, it's the next day's clock time.
          if (endHHMM < act.startTime) dayOffset = 1;
        }
      }
      if (!endHHMM) {
        const added = addMinutesToHHMM(act.startTime, DEFAULT_LAST_ACT_MINS);
        endHHMM = added.time;
        dayOffset = added.dayOffset;
      }
      act.endTime = endHHMM;
      if (dayOffset > 0) act.endDayOffset = dayOffset;
    }
  }
}

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return null;
  return { userId: user.id };
}

// Normalised name match — lowercase, drop "the ", strip non-alphanum.
// Same heuristic the venue dedupe tool uses. "Doghouse" and "The
// Doghouse Bar Dundee" both collapse to a key that's close enough to
// trigger a match.
function normVenue(name: string): string {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, "");
}

export type FestivalLineupVenueOption = {
  id: string;
  name: string;
  city: string | null;
};

export type LineupPreviewRow = {
  // Original Claude output preserved so the UI can show "AI extracted:
  // ..." next to the editable fields.
  raw: ExtractedLineupSlot;
  // Matched venue id when the AI's venue text mapped to an existing
  // Buzz venue (whether or not it's linked to this festival).
  matchedVenueId: string | null;
  matchedVenueName: string | null;
  // True when the matched venue exists in Buzz but isn't currently
  // linked to this festival — publish will auto-link it.
  needsFestivalLink: boolean;
  // True when no venue in Buzz matched at all. Publish will create a
  // brand-new venue with this name (using the festival's primary city)
  // and link it to the festival. UI shows a "+ Will create" badge.
  willCreateVenue: boolean;
  // Whether this artist already exists in our DB (by slug match). UI
  // shows a "new artist" tag for false. We still create the artist on
  // publish either way.
  artistExists: boolean;
};

export type ExtractLineupResult =
  | { error: string }
  | {
      ok: true;
      rows: LineupPreviewRow[];
      // ALL approved Buzz venues (festival's + others) for the override
      // dropdown. Lets admin re-point a row to a venue Claude didn't
      // suggest, e.g. "actually this is Doghouse not Dog Bar".
      venueOptions: FestivalLineupVenueOption[];
      // The default city_id new venues will be created in (festival's
      // primary city, derived from existing linked venues). UI shows
      // it as "+ Will create in Dundee" so admin knows where new venues
      // land.
      defaultCity: { id: string; name: string } | null;
      // The festival's days — derived from start/end dates — for the
      // day-picker dropdown.
      days: string[];
      // Counts so the admin can sanity-check the extraction at a glance.
      stats: { total: number; matchedExisting: number; willCreate: number };
    };

export async function extractFestivalLineupAction(opts: {
  festivalId: string;
  imageUrls: string[];
}): Promise<ExtractLineupResult> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  if (opts.imageUrls.length === 0) {
    return { error: "Upload at least one poster image first." };
  }

  const sb = createServiceClient();
  const { data: festival } = await sb
    .from("festivals")
    .select("id, name, slug, start_date, end_date")
    .eq("id", opts.festivalId)
    .maybeSingle();
  if (!festival) return { error: "Festival not found." };

  // Load ALL approved Buzz venues for matching + the override dropdown.
  // Previously we only matched against the festival's linked venues,
  // but the importer's now smart enough to (a) auto-link an existing
  // unlinked venue when a row uses it, and (b) auto-create brand-new
  // venues for poster entries we've never heard of. So matching against
  // the full venue catalogue gives a much better hit rate.
  const { data: allVenuesRaw } = await sb
    .from("venues")
    .select("id, name, city_id, city:cities(id, name)")
    .eq("approved", true)
    .order("name");
  const allVenues: FestivalLineupVenueOption[] = (allVenuesRaw ?? []).map((v: any) => ({
    id: v.id as string,
    name: v.name as string,
    city: (v.city?.name as string | null) ?? null,
  }));

  // Also load the festival's currently-linked venue IDs so we can flag
  // matches that need an auto-link on publish.
  const { data: linkedRows } = await sb
    .from("festival_venues")
    .select("venue_id")
    .eq("festival_id", festival.id);
  const linkedVenueIds = new Set<string>((linkedRows ?? []).map((r: any) => r.venue_id));
  const linkedVenueHints = allVenues.filter((v) => linkedVenueIds.has(v.id));

  // Run the extraction. We pass the festival's linked venues as hints
  // so Claude prefers known names where the poster matches them — but
  // it's free to extract any venue text the poster shows.
  let extraction;
  try {
    extraction = await extractFestivalLineup({
      festivalName: festival.name,
      startDate: festival.start_date,
      endDate: festival.end_date,
      venueOptions: linkedVenueHints.map((v) => ({ id: v.id, name: v.name })),
      imageUrls: opts.imageUrls,
    });
  } catch (e: any) {
    return { error: `Extraction failed: ${e?.message ?? "unknown error"}` };
  }

  if (extraction.slots.length === 0) {
    return {
      error: "Couldn't find a lineup in those images. Try a clearer photo, or upload separate close-ups of each section of the programme.",
    };
  }

  // Fuzzy-match each slot's venue against EVERY Buzz venue, not just
  // the festival's. Posters use shorthand ("Doghouse" vs "Doghouse Bar
  // Dundee"); the normVenue strip catches "the" + non-alphanums so
  // both forms hit the same key.
  const venueByNorm = new Map<string, FestivalLineupVenueOption>();
  for (const v of allVenues) venueByNorm.set(normVenue(v.name), v);

  // Determine the festival's primary city — used as the default city
  // for venues we'll create on publish. Most common city among the
  // festival's existing linked venues; falls back to the first active
  // city in the system if the festival has no venues yet.
  const defaultCity = await pickDefaultCity(sb, linkedVenueIds);

  // Pre-fetch existing artists by slug for the "new artist?" flag. One
  // round-trip rather than per-row lookup.
  const artistSlugs = Array.from(
    new Set(extraction.slots.map((s) => slugify(s.artist)).filter(Boolean)),
  );
  const existingArtistSlugs = new Set<string>();
  if (artistSlugs.length > 0) {
    const { data: existing } = await sb
      .from("artists")
      .select("slug")
      .in("slug", artistSlugs);
    for (const a of existing ?? []) existingArtistSlugs.add(a.slug);
  }

  let matchedExisting = 0;
  let willCreate = 0;
  const rows: LineupPreviewRow[] = extraction.slots.map((slot) => {
    // Strip the leftover "?: " prefix that older prompt versions used —
    // the current prompt doesn't emit it but defensive in case the
    // model regresses.
    const raw = slot.venue.replace(/^\?:\s*/, "");
    const venueMatch = venueByNorm.get(normVenue(raw)) ?? null;
    if (venueMatch) {
      matchedExisting++;
    } else {
      willCreate++;
    }
    return {
      raw: { ...slot, venue: raw },
      matchedVenueId: venueMatch?.id ?? null,
      matchedVenueName: venueMatch?.name ?? null,
      needsFestivalLink: venueMatch ? !linkedVenueIds.has(venueMatch.id) : false,
      willCreateVenue: !venueMatch,
      artistExists: existingArtistSlugs.has(slugify(slot.artist)),
    };
  });

  // Build the day list from the festival's date range — used by the UI
  // for the day-picker on each row.
  const days = enumerateDays(festival.start_date, festival.end_date);

  return {
    ok: true,
    rows,
    venueOptions: allVenues,
    defaultCity,
    days,
    stats: {
      total: rows.length,
      matchedExisting,
      willCreate,
    },
  };
}

// Best-guess primary city for the festival. Used as the default
// city_id for any venue we create on publish.
async function pickDefaultCity(
  sb: ReturnType<typeof createServiceClient>,
  linkedVenueIds: Set<string>,
): Promise<{ id: string; name: string } | null> {
  // 1. Most common city among the festival's existing linked venues.
  if (linkedVenueIds.size > 0) {
    const { data } = await sb
      .from("venues")
      .select("city_id, city:cities(id, name)")
      .in("id", Array.from(linkedVenueIds));
    const counts = new Map<string, { id: string; name: string; count: number }>();
    for (const row of (data ?? []) as any[]) {
      const cid = row.city?.id;
      const cname = row.city?.name;
      if (!cid || !cname) continue;
      const c = counts.get(cid) ?? { id: cid, name: cname, count: 0 };
      c.count++;
      counts.set(cid, c);
    }
    if (counts.size > 0) {
      const top = Array.from(counts.values()).sort((a, b) => b.count - a.count)[0];
      return { id: top.id, name: top.name };
    }
  }
  // 2. Fall back to the first active city in the system.
  const { data: anyCity } = await sb
    .from("cities")
    .select("id, name")
    .eq("active", true)
    .order("name")
    .limit(1)
    .maybeSingle();
  if (anyCity) return { id: anyCity.id, name: anyCity.name };
  return null;
}

// Inclusive day enumeration. Dates are "YYYY-MM-DD" strings; midday
// trick avoids the DST-boundary wobble seen elsewhere in the codebase.
function enumerateDays(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  const start = new Date(startYmd + "T12:00:00");
  const end = new Date(endYmd + "T12:00:00");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [startYmd];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// ============================================================
// PUBLISH
// ============================================================

export type PublishDraft = {
  // One of:
  //   - { venueId: "<existing-id>" } — use this venue, auto-link to
  //     festival if not already linked
  //   - { venueId: null, createVenueName: "Some Pub", cityId: "<id>" }
  //     — create a new venue with this name + city, link to festival,
  //     then create the event
  venueId: string | null;
  createVenueName: string | null;
  cityId: string | null;
  artistName: string;
  day: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string | null; // HH:mm or null
  // Internally set by the end-time inference step when an inferred
  // end wraps past midnight (e.g. 23:30 set ending at 01:00). NULL
  // means the end falls on the same date as `day`. UI rows leave
  // this unset; only the publish path's preprocessing populates it.
  endDayOffset?: number;
  stage: string | null;
};

export type PublishLineupResult =
  | { error: string }
  | {
      ok: true;
      created: number;
      skipped: number;
      // Number of new venues created on the fly during this publish.
      venuesCreated: number;
      // Number of existing-but-not-linked venues auto-linked to the
      // festival as part of this publish.
      venuesLinked: number;
      errors: string[];
    };

export async function publishFestivalLineupAction(opts: {
  festivalId: string;
  drafts: PublishDraft[];
}): Promise<PublishLineupResult> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  if (opts.drafts.length === 0) return { error: "No rows ticked to publish." };

  const sb = createServiceClient();
  const { data: festival } = await sb
    .from("festivals")
    .select("id, name, slug")
    .eq("id", opts.festivalId)
    .maybeSingle();
  if (!festival) return { error: "Festival not found." };

  // Festival's currently-linked venues. Used to detect which rows need
  // an auto-link added (existing venue that isn't yet on this festival).
  const { data: linkedRows } = await sb
    .from("festival_venues")
    .select("venue_id, sort_order")
    .eq("festival_id", festival.id);
  const linkedVenueIds = new Set<string>((linkedRows ?? []).map((r: any) => r.venue_id));
  let nextSortOrder = ((linkedRows ?? []).reduce(
    (max: number, r: any) => Math.max(max, r.sort_order ?? 0),
    0,
  )) + 1;

  // ── End-time inference ──────────────────────────────────────
  // Most festival posters only show start times — Claude returns
  // endTime as null for those. Without an end_time the public site
  // can't tell when an act stops, and listings show it as running
  // until end-of-day. So we infer:
  //   - For non-last acts at the same venue + same day: end_time =
  //     next act's start_time. Festival sets are typically scheduled
  //     back-to-back on one stage.
  //   - For the LAST act of the day at each venue: end_time = venue's
  //     opening_hours_json close time for that weekday, falling back
  //     to start + 90 mins when no hours are set (or the venue is
  //     being created on the fly).
  // Rows where Claude already extracted an explicit end time are
  // respected — only nulls get filled.
  const venueIdsForHours = Array.from(
    new Set(opts.drafts.map((d) => d.venueId).filter((id): id is string => !!id)),
  );
  let venueHoursById = new Map<string, any>();
  if (venueIdsForHours.length > 0) {
    const { data: venuesWithHours } = await sb
      .from("venues")
      .select("id, opening_hours_json")
      .in("id", venueIdsForHours);
    venueHoursById = new Map(
      (venuesWithHours ?? []).map((v: any) => [v.id, v.opening_hours_json]),
    );
  }
  inferMissingEndTimes(opts.drafts, venueHoursById);

  // Public-page revalidation set: track every venue + city slug we
  // touch so we can bust caches in one pass at the end (rather than
  // per-row, which would issue 80+ revalidations for a busy festival).
  const venueCitySlugs = new Set<string>();

  let created = 0;
  let skipped = 0;
  let venuesCreated = 0;
  let venuesLinked = 0;
  const errors: string[] = [];

  for (const draft of opts.drafts) {
    // Resolve which venue to use: existing one OR create on the fly.
    let venueId: string | null = null;
    let venueCityId: string | null = null;
    let venueCitySlug: string | null = null;

    if (draft.venueId) {
      // Use existing. Verify it still exists; pull city info for the
      // revalidation set.
      const { data: existing } = await sb
        .from("venues")
        .select("id, name, city_id, city:cities(slug)")
        .eq("id", draft.venueId)
        .maybeSingle();
      if (!existing) {
        skipped++;
        errors.push(`${draft.artistName}: venue no longer exists`);
        continue;
      }
      venueId = existing.id;
      venueCityId = existing.city_id ?? null;
      venueCitySlug = (existing as any).city?.slug ?? null;
    } else if (draft.createVenueName && draft.cityId) {
      // Create a new venue. Approved=true because the admin curated
      // this lineup (vs FB-scrape new venues which start unapproved).
      const venueName = draft.createVenueName.trim();
      if (!venueName) {
        skipped++;
        errors.push(`${draft.artistName}: blank new-venue name`);
        continue;
      }
      const baseSlug = slugify(venueName) || "venue";
      let trySlug = baseSlug;
      let newVenueId: string | null = null;
      for (let i = 0; i < 5 && !newVenueId; i++) {
        const { data: ins, error } = await sb
          .from("venues")
          .insert({
            name: venueName,
            slug: trySlug,
            city_id: draft.cityId,
            approved: true,
          })
          .select("id")
          .single();
        if (ins) {
          newVenueId = ins.id;
          venuesCreated++;
          break;
        }
        if (error?.code === "23505") {
          // Slug collision — try suffix. Also covers the (rare) case
          // where a duplicate-name venue exists; we get a fresh row for
          // this festival's purposes.
          trySlug = `${baseSlug}-${i + 2}`;
          continue;
        }
        skipped++;
        errors.push(`${draft.artistName}: couldn't create venue "${venueName}": ${error?.message ?? "unknown"}`);
        break;
      }
      if (!newVenueId) {
        if (!errors.some((e) => e.includes(venueName))) {
          skipped++;
          errors.push(`${draft.artistName}: couldn't find a free slug for "${venueName}"`);
        }
        continue;
      }
      venueId = newVenueId;
      venueCityId = draft.cityId;
      // Get the city slug for revalidation.
      const { data: city } = await sb
        .from("cities")
        .select("slug")
        .eq("id", draft.cityId)
        .maybeSingle();
      venueCitySlug = city?.slug ?? null;
    } else {
      skipped++;
      errors.push(`${draft.artistName}: no venue picked and no create-venue name`);
      continue;
    }

    if (!venueId) {
      skipped++;
      errors.push(`${draft.artistName}: venue resolution failed`);
      continue;
    }

    // Auto-link this venue to the festival if it isn't already.
    if (!linkedVenueIds.has(venueId)) {
      const { error: linkErr } = await sb
        .from("festival_venues")
        .insert({
          festival_id: festival.id,
          venue_id: venueId,
          sort_order: nextSortOrder++,
        });
      if (!linkErr) {
        linkedVenueIds.add(venueId);
        venuesLinked++;
      }
      // If link failed (e.g. duplicate from a race), it's fine —
      // remember the venue's already linked and move on.
      else if (linkErr.code === "23505") {
        linkedVenueIds.add(venueId);
      }
    }

    // Wrap up for the synthetic "venue" the rest of the loop expects.
    const venue = {
      name: "",
      city_id: venueCityId,
      citySlug: venueCitySlug,
    };
    if (venueCitySlug) venueCitySlugs.add(venueCitySlug);
    // Convert day + time into a proper UTC ISO via the London-aware
    // helper — the fix from claude/fix-event-time-timezone applies here
    // too. Without it, "20:00 on day X" would land as 20:00 UTC.
    const startIso = londonWallClockToIso(`${draft.day}T${draft.startTime}`);
    if (!startIso) {
      skipped++;
      errors.push(`${draft.artistName}: invalid start time`);
      continue;
    }
    // For end time, the inference pass may have flagged that the end
    // wraps past midnight (endDayOffset = 1). Compute the actual end
    // date so a 23:00 set ending at 01:00 stores as next-day 01:00,
    // not same-day 01:00 (which would be EARLIER than start).
    let endIso: string | null = null;
    if (draft.endTime) {
      const endDate = draft.endDayOffset && draft.endDayOffset > 0
        ? addDaysToYmd(draft.day, draft.endDayOffset)
        : draft.day;
      endIso = londonWallClockToIso(`${endDate}T${draft.endTime}`);
      // Defensive: if the resulting end_iso is still before start (e.g.
      // admin manually set an end time of 01:00 with no dayOffset hint),
      // bump forward a day.
      if (endIso && startIso && new Date(endIso) <= new Date(startIso)) {
        endIso = new Date(
          new Date(endIso).getTime() + 24 * 60 * 60 * 1000,
        ).toISOString();
      }
    }

    // Find-or-create the artist. Approved=true because the admin
    // curated this lineup (vs auto-imported artists from FB scrape
    // which start unapproved).
    const slug = slugify(draft.artistName) || "act";
    let artistId: string | null = null;
    const { data: existingArtist } = await sb
      .from("artists")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (existingArtist) {
      artistId = existingArtist.id;
    } else {
      // Unique-slug suffixing — handles two distinct acts that slugify
      // identically (rare but possible).
      let trySlug = slug;
      for (let i = 0; i < 5 && !artistId; i++) {
        const { data: ins, error } = await sb
          .from("artists")
          .insert({
            name: draft.artistName,
            slug: trySlug,
            city_id: venue.city_id,
            approved: true,
          })
          .select("id")
          .single();
        if (ins) {
          artistId = ins.id;
          break;
        }
        if (error?.code === "23505") {
          trySlug = `${slug}-${i + 2}`;
          continue;
        }
        break;
      }
    }
    if (!artistId) {
      skipped++;
      errors.push(`${draft.artistName}: couldn't create artist`);
      continue;
    }

    // Build the event title. Stage shown in brackets when present so
    // the public schedule reads "Kyle Falconer (Main Stage)" — useful
    // for festivals with multiple stages per venue.
    const title = draft.stage
      ? `${draft.artistName} (${draft.stage})`
      : draft.artistName;

    const { data: event, error: insErr } = await sb
      .from("events")
      .insert({
        // venueId here is the RESOLVED id (existing OR just-created),
        // not necessarily draft.venueId which can be null for the
        // create-new path.
        venue_id: venueId,
        title: title.slice(0, 200),
        start_time: startIso,
        end_time: endIso,
        status: "approved",
        auto_imported_from: "festival_lineup",
        auto_import_confidence: 1.0,
      })
      .select("id")
      .single();
    if (insErr || !event) {
      skipped++;
      errors.push(`${draft.artistName}: ${insErr?.message ?? "insert failed"}`);
      continue;
    }

    // Link artist. Best-effort — if this fails we keep the event but
    // the schedule won't tag the artist.
    await sb
      .from("event_artists")
      .upsert(
        [{ event_id: event.id, artist_id: artistId }],
        { onConflict: "event_id,artist_id", ignoreDuplicates: true },
      );

    created++;
  }

  // Bust the festival page's cache so the new schedule appears at once.
  if (festival.slug) revalidatePath(`/festivals/${festival.slug}`);
  // And every touched city's venues index — they show the festival
  // events via the venue's normal listing.
  for (const slug of venueCitySlugs) {
    revalidatePath(`/${slug}/venues`);
  }

  return { ok: true, created, skipped, venuesCreated, venuesLinked, errors };
}
