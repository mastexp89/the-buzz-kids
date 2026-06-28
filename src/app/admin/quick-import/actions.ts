"use server";

// Admin Quick Import server actions.
//
// Lets an admin drop a poster image, AI extracts events + suggests venue + artists,
// admin maps to existing or creates new, and events publish straight to live.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { extractEvents, type ExtractedEvent } from "@/lib/extraction";
import { uploadPosterFromUrl } from "@/lib/poster-storage";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return null;
  return { userId: user.id };
}

// Each extracted artist name, optionally pre-matched to an existing
// artists.id so the review UI shows it as a confirmed link rather than
// "(new)" the admin has to manually re-pick.
export type QuickDraftArtist = {
  name: string;
  matchedArtistId?: string;
};

export type QuickDraft = {
  title: string;
  starts_at: string;
  ends_at: string | null;
  description: string;
  genres: string[];
  artists: QuickDraftArtist[];
  confidence: number;
  venue_hint: string | null;
  cover_charge: string | null;
  ticket_url: string | null;
  posterImageUrl: string;
};

// Normalise a name for fuzzy matching: lowercase, drop "the ", strip any
// non-alphanumeric. Mirrors /dashboard/setup so we get the same matches.
// (Kept un-exported because Next.js "use server" files can only export
// async server actions — sync helpers stay file-private.)
function normaliseArtistName(s: string): string {
  return s.toLowerCase().trim().replace(/^the\s+/i, "").replace(/[^a-z0-9]+/g, "");
}

/**
 * For each AI-extracted artist name, look up an existing artists row
 * with the same normalised name. Returns one QuickDraftArtist per input,
 * with matchedArtistId populated when found.
 */
export async function matchArtistsToDb(
  sb: ReturnType<typeof createServiceClient>,
  names: string[],
): Promise<QuickDraftArtist[]> {
  const trimmed = Array.from(new Set(names.map((s) => s.trim()).filter(Boolean)));
  if (trimmed.length === 0) return [];

  // Build a single ilike query covering every name. Postgres doesn't support
  // OR-of-ilikes directly via supabase-js, so we use .or() with a comma list.
  const orFilters = trimmed
    .map((n) => `name.ilike.%${n.replace(/[%_,()]/g, "")}%`)
    .join(",");
  const { data: rows } = await sb
    .from("artists")
    .select("id, name")
    .or(orFilters)
    .limit(200);

  // Index DB rows by normalised name so we can do O(1) lookups per input.
  const dbByNorm = new Map<string, { id: string; name: string }>();
  for (const r of rows ?? []) {
    const norm = normaliseArtistName(r.name);
    if (!dbByNorm.has(norm)) dbByNorm.set(norm, { id: r.id, name: r.name });
  }

  return names
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((name) => {
      const match = dbByNorm.get(normaliseArtistName(name));
      return match ? { name, matchedArtistId: match.id } : { name };
    });
}

/**
 * Apply DB artist matches to a batch of drafts in one shot. Used by both
 * extractQuickFromPoster and the site importer so admins don't have to
 * manually re-pick existing artists in the review UI.
 */
export async function applyArtistMatchesToDrafts(
  sb: ReturnType<typeof createServiceClient>,
  drafts: QuickDraft[],
): Promise<QuickDraft[]> {
  const allNames = drafts.flatMap((d) => d.artists.map((a) => a.name));
  if (allNames.length === 0) return drafts;
  const matches = await matchArtistsToDb(sb, allNames);
  const matchByNorm = new Map<string, QuickDraftArtist>();
  for (const m of matches) matchByNorm.set(normaliseArtistName(m.name), m);
  return drafts.map((d) => ({
    ...d,
    artists: d.artists.map((a) => matchByNorm.get(normaliseArtistName(a.name)) ?? a),
  }));
}

export type ExtractQuickResult =
  | { ok: true; drafts: QuickDraft[] }
  | { error: string };

export async function extractQuickFromPoster(opts: {
  imageUrl: string;
}): Promise<ExtractQuickResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };

  const sb = createServiceClient();
  const { data: genres } = await sb.from("genres").select("slug, name").order("name");

  let extraction;
  try {
    extraction = await extractEvents({
      venueName: "(unknown — please detect from poster)",
      postedAt: new Date().toISOString(),
      imageUrls: [opts.imageUrl],
      availableGenres: (genres ?? []).map((g) => ({ slug: g.slug, name: g.name })),
    });
  } catch (e: any) {
    return { error: `Extraction failed: ${e?.message ?? "unknown error"}` };
  }

  const rawDrafts: QuickDraft[] = extraction.events.map((e: ExtractedEvent) => ({
    title: e.title,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    description: e.description ?? "",
    genres: e.genres ?? [],
    artists: (e.artists ?? [])
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name): QuickDraftArtist => ({ name })),
    confidence: e.confidence,
    venue_hint: e.venue_hint,
    cover_charge: e.cover_charge,
    ticket_url: e.ticket_url,
    posterImageUrl: opts.imageUrl,
  }));

  // Pre-match artist names so the review UI shows confirmed-existing chips.
  const drafts = await applyArtistMatchesToDrafts(sb, rawDrafts);

  return { ok: true, drafts };
}

export type VenueOption = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  approved: boolean;
};

export async function searchVenues(query: string): Promise<VenueOption[]> {
  const ctx = await requireAdmin();
  if (!ctx) return [];
  const q = query.trim();
  const sb = createServiceClient();
  let req = sb
    .from("venues")
    .select("id, name, slug, approved, city:cities(name)")
    .order("name")
    .limit(15);
  if (q.length > 0) {
    req = req.ilike("name", `%${q.replace(/[%_]/g, "")}%`);
  }
  const { data } = await req;
  return (data ?? []).map((v: any) => ({
    id: v.id,
    name: v.name,
    slug: v.slug,
    city: v.city?.name ?? null,
    approved: v.approved,
  }));
}

export type ArtistOption = {
  id: string;
  name: string;
  slug: string;
};

export async function searchArtists(query: string): Promise<ArtistOption[]> {
  const ctx = await requireAdmin();
  if (!ctx) return [];
  const q = query.trim();
  if (q.length === 0) return [];
  const sb = createServiceClient();
  const { data } = await sb
    .from("artists")
    .select("id, name, slug")
    .ilike("name", `%${q.replace(/[%_]/g, "")}%`)
    .order("name")
    .limit(10);
  return (data ?? []) as ArtistOption[];
}

export type ArtistRef = { id: string } | { name: string };

export type QuickConflictExisting = {
  id: string;
  title: string;
  start_time: string;
  image_url: string | null;
  description: string | null;
  auto_imported_from: string | null;
};

export type QuickConflict = {
  draftIdx: number;
  draftTitle: string;
  draftStart: string;
  existing: QuickConflictExisting;
};

export type QuickConflictResolution = "skip" | "replace" | "keep_both";

export type PublishQuickInput = {
  venueRef: { id: string } | { name: string; cityId?: string | null };
  drafts: Array<{
    title: string;
    starts_at: string;
    ends_at: string | null;
    description: string;
    genres: string[];
    artists: ArtistRef[];
    confidence: number;
    cover_charge?: string | null;
    ticket_url?: string | null;
    posterImageUrl: string;
  }>;
  // Optional per-draft resolution. If venueRef is "new" no conflicts can exist
  // (venue gets created), so resolutions are ignored. Keys are draft indices
  // (within this call's drafts array).
  resolutions?: Record<number, QuickConflictResolution>;
};

export type PublishQuickResult =
  | { ok: true; published: number; skipped: number; replaced: number; venueId: string }
  | { conflicts: QuickConflict[]; venueId: string }
  | { error: string };

function quickHourKey(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}`;
}

function quickNormTitle(t: string): string {
  return (t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Read-only: given an existing venue ID + draft titles/times, return any clashes.
// Used for pre-flight detection so the UI can show "already booked, what do?"
// before committing any inserts.
export async function detectQuickConflicts(opts: {
  venueId: string;
  drafts: { title: string; starts_at: string }[];
}): Promise<{ conflicts: QuickConflict[] } | { error: string }> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };

  const sb = createServiceClient();
  const { data: existing } = await sb
    .from("events")
    .select("id, title, start_time, image_url, description, auto_imported_from")
    .eq("venue_id", opts.venueId)
    .neq("status", "rejected");

  const byHour = new Map<string, QuickConflictExisting[]>();
  for (const e of existing ?? []) {
    const hk = quickHourKey(e.start_time);
    const list = byHour.get(hk) ?? [];
    list.push({
      id: e.id,
      title: e.title,
      start_time: e.start_time,
      image_url: e.image_url,
      description: e.description,
      auto_imported_from: e.auto_imported_from,
    });
    byHour.set(hk, list);
  }

  const conflicts: QuickConflict[] = [];
  for (let i = 0; i < opts.drafts.length; i++) {
    const d = opts.drafts[i];
    const hk = quickHourKey(d.starts_at);
    const sameHour = byHour.get(hk) ?? [];
    if (sameHour.length === 0) continue;
    const nt = quickNormTitle(d.title);
    const titleMatch = sameHour.find((e) => {
      const en = quickNormTitle(e.title);
      if (en === nt) return true;
      if (nt.length >= 6 && en.length >= 6 && (en.includes(nt) || nt.includes(en))) return true;
      return false;
    });
    // Same venue + same hour is enough for a conflict — surface even if titles differ
    const match = titleMatch ?? sameHour[0];
    conflicts.push({
      draftIdx: i,
      draftTitle: d.title,
      draftStart: d.starts_at,
      existing: match,
    });
  }

  return { conflicts };
}

export async function publishQuickDrafts(input: PublishQuickInput): Promise<PublishQuickResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };
  if (input.drafts.length === 0) return { error: "No drafts." };

  // Guard: events.start_time is NOT NULL — drop drafts without a valid datetime
  // before any further work so we don't crash the insert mid-batch.
  input.drafts = input.drafts.filter((d) => {
    if (!d.title || !d.title.trim()) return false;
    if (!d.starts_at) return false;
    const t = new Date(d.starts_at);
    return !Number.isNaN(t.getTime());
  });
  if (input.drafts.length === 0) {
    return { error: "All drafts were missing a title or start time. Fill those in and retry." };
  }

  const sb = createServiceClient();

  // Resolve venue: either an existing ID or a new venue we create on the fly.
  let venueId: string;
  let cityId: string | null = null;
  let venueSlug = "";
  let citySlug = "dundee";

  if ("id" in input.venueRef) {
    const { data: v } = await sb
      .from("venues")
      .select("id, slug, city_id, city:cities(slug)")
      .eq("id", input.venueRef.id)
      .maybeSingle();
    if (!v) return { error: "Venue not found." };
    venueId = v.id;
    cityId = v.city_id ?? null;
    venueSlug = v.slug;
    citySlug = (v.city as any)?.slug ?? "dundee";
  } else {
    const name = input.venueRef.name.trim();
    if (!name) return { error: "Venue name empty." };
    const slugBase = name
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "venue";

    // Default to Dundee city if no cityId given
    if (!input.venueRef.cityId) {
      const { data: dundee } = await sb.from("cities").select("id, slug").eq("slug", "dundee").maybeSingle();
      cityId = dundee?.id ?? null;
      citySlug = dundee?.slug ?? "dundee";
    } else {
      cityId = input.venueRef.cityId;
      const { data: city } = await sb.from("cities").select("slug").eq("id", cityId).maybeSingle();
      citySlug = city?.slug ?? "dundee";
    }

    let slug = slugBase;
    let venue: any = null;
    for (let i = 0; i < 5; i++) {
      const { data: created, error } = await sb
        .from("venues")
        .insert({ name, slug, city_id: cityId, approved: true, auto_imported: true })
        .select("id, slug")
        .single();
      if (!error && created) { venue = created; break; }
      if (error?.code === "23505") { slug = `${slugBase}-${i + 2}`; continue; }
      return { error: `Failed to create venue: ${error?.message ?? "unknown"}` };
    }
    if (!venue) return { error: "Couldn't generate unique venue slug." };
    venueId = venue.id;
    venueSlug = venue.slug;
  }

  // Genre slug -> id
  const { data: genreRows } = await sb.from("genres").select("id, slug");
  const genreSlugToId = new Map<string, string>();
  for (const g of genreRows ?? []) genreSlugToId.set(g.slug, g.id);

  // Conflict detection — same venue + same hour. Also flag when titles overlap
  // (existing behaviour); generic-vs-specific is caught here too.
  const { data: existingFull } = await sb
    .from("events")
    .select("id, title, start_time, image_url, description, auto_imported_from")
    .eq("venue_id", venueId)
    .neq("status", "rejected");
  const byHour = new Map<string, QuickConflictExisting[]>();
  for (const e of existingFull ?? []) {
    const hk = quickHourKey(e.start_time);
    const list = byHour.get(hk) ?? [];
    list.push({
      id: e.id,
      title: e.title,
      start_time: e.start_time,
      image_url: e.image_url,
      description: e.description,
      auto_imported_from: e.auto_imported_from,
    });
    byHour.set(hk, list);
  }

  // Per-draft conflict — first match in same-hour wins (prefer title overlap).
  const conflictsFound: { draftIdx: number; existing: QuickConflictExisting }[] = [];
  for (let i = 0; i < input.drafts.length; i++) {
    const d = input.drafts[i];
    const hk = quickHourKey(d.starts_at);
    const sameHour = byHour.get(hk) ?? [];
    if (sameHour.length === 0) continue;
    const nt = quickNormTitle(d.title);
    const titleMatch = sameHour.find((e) => {
      const en = quickNormTitle(e.title);
      if (en === nt) return true;
      if (nt.length >= 6 && en.length >= 6 && (en.includes(nt) || nt.includes(en))) return true;
      return false;
    });
    conflictsFound.push({ draftIdx: i, existing: titleMatch ?? sameHour[0] });
  }

  // If conflicts exist and the caller didn't pass resolutions, return them so
  // the UI can ask the user (Keep / Replace / Keep both). Backwards-compat: if
  // the caller doesn't care (no resolutions param), we silently skip dupes
  // exactly like before — that path is used by older callers that haven't
  // migrated yet.
  const resolutions = input.resolutions ?? null;
  const unresolved = resolutions === null
    ? []
    : conflictsFound.filter((c) => !resolutions[c.draftIdx]);
  if (resolutions !== null && unresolved.length > 0) {
    return {
      conflicts: unresolved.map((c) => ({
        draftIdx: c.draftIdx,
        draftTitle: input.drafts[c.draftIdx].title,
        draftStart: input.drafts[c.draftIdx].starts_at,
        existing: c.existing,
      })),
      venueId,
    };
  }

  // Apply resolutions if provided, else fall back to silent skip behaviour.
  const replaceIds: string[] = [];
  const skipIdxs = new Set<number>();
  if (resolutions !== null) {
    for (const c of conflictsFound) {
      const r = resolutions[c.draftIdx];
      if (r === "skip") skipIdxs.add(c.draftIdx);
      else if (r === "replace") replaceIds.push(c.existing.id);
      // "keep_both" → no-op, just insert alongside
    }
  } else {
    // Legacy: silently skip every conflict
    for (const c of conflictsFound) skipIdxs.add(c.draftIdx);
  }

  if (replaceIds.length > 0) {
    await sb.from("event_artists").delete().in("event_id", replaceIds);
    await sb.from("event_genres").delete().in("event_id", replaceIds);
    await sb.from("events").delete().in("id", replaceIds);
  }

  const dedupedDrafts: typeof input.drafts = [];
  for (let i = 0; i < input.drafts.length; i++) {
    if (skipIdxs.has(i)) continue;
    dedupedDrafts.push(input.drafts[i]);
  }
  const skipped = skipIdxs.size;

  if (dedupedDrafts.length === 0) {
    return { ok: true, published: 0, skipped, replaced: replaceIds.length, venueId };
  }

  // Insert events (auto-approved — admin is publishing). Normalise empty
  // string poster URLs to null so the column doesn't get junk values when
  // an admin removed the image in the review screen.
  const eventRows = dedupedDrafts.map((d) => {
    const poster = d.posterImageUrl?.trim() || null;
    return {
      venue_id: venueId,
      title: d.title.trim().slice(0, 200),
      start_time: d.starts_at,
      end_time: d.ends_at,
      description: (d.description ?? "").trim().slice(0, 2000),
      cover_charge: d.cover_charge?.trim().slice(0, 100) || null,
      ticket_url: d.ticket_url?.trim().slice(0, 500) || null,
      status: "approved",
      submitted_by: ctx.userId,
      auto_imported_from: "manual_upload",
      auto_import_confidence: d.confidence,
      auto_import_image_url: poster,
      image_url: poster,
    };
  });
  const { data: created, error: insErr } = await sb
    .from("events")
    .insert(eventRows)
    .select("id");
  if (insErr) return { error: `Failed to create events: ${insErr.message}` };
  if (!created || created.length === 0) return { error: "No events created." };

  // Persist poster to storage (one per event since posters can differ)
  for (let i = 0; i < created.length; i++) {
    const id = created[i].id;
    const src = dedupedDrafts[i].posterImageUrl;
    if (!src) continue;
    const stored = await uploadPosterFromUrl(sb, { sourceUrl: src, eventId: id });
    if ("ok" in stored) {
      await sb.from("events")
        .update({ image_url: stored.publicUrl, auto_import_image_url: stored.publicUrl })
        .eq("id", id);
    }
  }

  // Link genres
  const genreLinks: { event_id: string; genre_id: string }[] = [];
  dedupedDrafts.forEach((d, i) => {
    const eventId = created[i]?.id;
    if (!eventId) return;
    for (const slug of d.genres) {
      const gid = genreSlugToId.get(slug);
      if (gid) genreLinks.push({ event_id: eventId, genre_id: gid });
    }
  });
  if (genreLinks.length > 0) await sb.from("event_genres").insert(genreLinks);

  // Link artists. For each draft, resolve refs (id or new name) into artist IDs.
  const artistLinks: { event_id: string; artist_id: string }[] = [];
  for (let i = 0; i < dedupedDrafts.length; i++) {
    const eventId = created[i]?.id;
    if (!eventId) continue;
    for (const ref of dedupedDrafts[i].artists) {
      let artistId: string | null = null;
      if ("id" in ref) {
        artistId = ref.id;
      } else {
        const name = ref.name.trim();
        if (!name) continue;
        // Try to find by name (case-insensitive), else create
        const { data: existing } = await sb
          .from("artists")
          .select("id")
          .ilike("name", name)
          .maybeSingle();
        if (existing) {
          artistId = existing.id;
        } else {
          const slug = name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9\s-]/g, "")
            .replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "artist";
          let attempt = slug;
          for (let j = 0; j < 5; j++) {
            const { data: nu, error } = await sb
              .from("artists")
              .insert({ name, slug: attempt, city_id: cityId, approved: true })
              .select("id")
              .single();
            if (!error && nu) { artistId = nu.id; break; }
            if (error?.code === "23505") { attempt = `${slug}-${j + 2}`; continue; }
            break;
          }
        }
      }
      if (artistId) artistLinks.push({ event_id: eventId, artist_id: artistId });
    }
  }
  if (artistLinks.length > 0) {
    await sb.from("event_artists").upsert(artistLinks, {
      onConflict: "event_id,artist_id",
      ignoreDuplicates: true,
    });
  }

  revalidatePath(`/${citySlug}/venues/${venueSlug}`);
  revalidatePath(`/${citySlug}`);
  revalidatePath("/artists");

  return { ok: true, published: created.length, skipped, replaced: replaceIds.length, venueId };
}
