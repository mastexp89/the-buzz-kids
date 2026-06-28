"use server";

// Server actions for venue / artist poster uploads.
//
// Two-phase flow:
//   1. extractDraftsFromPoster — runs AI extraction on an uploaded poster URL
//      and returns drafts the user can review + edit. NO DB writes here.
//   2. publishPosterDrafts — caller-edited drafts get persisted as events.
//      Auto-approves if the venue has an owner (claimed); pending otherwise.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { extractEvents, type ExtractedEvent } from "@/lib/extraction";
import { uploadPosterFromUrl } from "@/lib/poster-storage";
import { revalidatePath } from "next/cache";

const ALLOWED_ROLES = new Set(["venue_owner", "artist", "event_organiser", "admin"]);

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!prof || !ALLOWED_ROLES.has(prof.role)) return null;
  return { userId: user.id, role: prof.role as string };
}

export type DraftEvent = {
  title: string;
  starts_at: string;
  ends_at: string | null;
  description: string;
  genres: string[];
  artists: string[];
  confidence: number;
};

export type ExtractDraftsResult =
  | { ok: true; drafts: DraftEvent[]; venueOwned: boolean; venueName: string }
  | { error: string };

export async function extractDraftsFromPoster(opts: {
  venueId: string;
  imageUrl: string;
}): Promise<ExtractDraftsResult> {
  const ctx = await requireUser();
  if (!ctx) return { error: "You need an artist or venue account to upload posters." };

  const sb = createServiceClient();
  const { data: venue } = await sb
    .from("venues")
    .select("id, name, owner_id, approved")
    .eq("id", opts.venueId)
    .maybeSingle();
  if (!venue) return { error: "Venue not found." };
  if (!venue.approved) return { error: "Venue not approved yet." };

  // For venue-owner role: only allow uploading for their own venue.
  if (ctx.role === "venue_owner" && venue.owner_id && venue.owner_id !== ctx.userId) {
    return { error: "You can only upload posters for venues you own." };
  }

  const { data: genres } = await sb.from("genres").select("slug, name").order("name");

  let extraction;
  try {
    extraction = await extractEvents({
      venueName: venue.name,
      postedAt: new Date().toISOString(),
      imageUrls: [opts.imageUrl],
      availableCategories: (genres ?? []).map((g) => ({ slug: g.slug, name: g.name })),
    });
  } catch (e: any) {
    return { error: `Extraction failed: ${e?.message ?? "unknown error"}` };
  }

  const drafts: DraftEvent[] = extraction.events.map((e: ExtractedEvent) => ({
    title: e.title,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    description: e.description ?? "",
    genres: e.categories ?? [],
    artists: [],
    confidence: e.confidence,
  }));

  return {
    ok: true,
    drafts,
    venueOwned: !!venue.owner_id,
    venueName: venue.name,
  };
}

// Pre-flight conflict check: takes the panel's flat draft list and returns
// any same-venue, same-hour collisions. Read-only — does NOT insert.
// `draftIdx` here refers to the index in the input array (panel-global).
export async function detectPosterConflicts(opts: {
  venueId: string;
  drafts: { title: string; starts_at: string }[];
}): Promise<{ conflicts: PosterConflict[] } | { error: string }> {
  const ctx = await requireUser();
  if (!ctx) return { error: "Not authorised." };

  const sb = createServiceClient();
  const { data: venue } = await sb
    .from("venues")
    .select("id, owner_id")
    .eq("id", opts.venueId)
    .maybeSingle();
  if (!venue) return { error: "Venue not found." };

  if (ctx.role === "venue_owner" && venue.owner_id && venue.owner_id !== ctx.userId) {
    return { error: "Not authorised for this venue." };
  }

  const { data: existing } = await sb
    .from("events")
    .select("id, title, start_time, image_url, description, auto_imported_from")
    .eq("venue_id", opts.venueId)
    .neq("status", "rejected");

  const byHour = new Map<string, ConflictExisting[]>();
  for (const e of existing ?? []) {
    const hk = hourKey(e.start_time);
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

  const conflicts: PosterConflict[] = [];
  for (let i = 0; i < opts.drafts.length; i++) {
    const d = opts.drafts[i];
    const hk = hourKey(d.starts_at);
    const sameHour = byHour.get(hk) ?? [];
    if (sameHour.length === 0) continue;
    const nt = normTitle(d.title);
    const titleMatch = sameHour.find((e) => {
      const en = normTitle(e.title);
      if (en === nt) return true;
      if (nt.length >= 6 && en.length >= 6 && (en.includes(nt) || nt.includes(en))) return true;
      return false;
    });
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

export type ConflictExisting = {
  id: string;
  title: string;
  start_time: string;
  image_url: string | null;
  description: string | null;
  auto_imported_from: string | null;
};

export type PosterConflict = {
  draftIdx: number;
  draftTitle: string;
  draftStart: string;
  existing: ConflictExisting;
};

// Resolution strategy per draft index:
//   "skip"      — drop the new draft, keep existing
//   "replace"   — delete existing, insert new (note: this is hard delete; previous artist links go too)
//   "keep_both" — insert new alongside existing
export type ConflictResolution = "skip" | "replace" | "keep_both";

export type PublishResult =
  | { ok: true; published: number; pending: boolean; replaced?: number; skipped?: number }
  | { conflicts: PosterConflict[] }
  | { error: string };

function hourKey(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}`;
}

function normTitle(t: string): string {
  return (t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export async function publishPosterDrafts(opts: {
  venueId: string;
  posterImageUrl: string;
  drafts: DraftEvent[];
  resolutions?: Record<number, ConflictResolution>;
}): Promise<PublishResult> {
  const ctx = await requireUser();
  if (!ctx) return { error: "Not authorised." };

  if (opts.drafts.length === 0) return { error: "No drafts to publish." };
  if (opts.drafts.length > 20) return { error: "Too many drafts in one batch." };

  // Guard: events.start_time is NOT NULL. Filter out drafts that the AI
  // returned without a valid datetime (or where the user cleared it).
  opts.drafts = opts.drafts.filter((d) => {
    if (!d.title || !d.title.trim()) return false;
    if (!d.starts_at) return false;
    const t = new Date(d.starts_at);
    return !Number.isNaN(t.getTime());
  });
  if (opts.drafts.length === 0) {
    return { error: "All drafts were missing a title or start time. Fill those in and retry." };
  }

  const sb = createServiceClient();
  const { data: venue } = await sb
    .from("venues")
    .select("id, name, slug, owner_id, city_id, city:cities(slug)")
    .eq("id", opts.venueId)
    .maybeSingle();
  if (!venue) return { error: "Venue not found." };

  if (ctx.role === "venue_owner" && venue.owner_id && venue.owner_id !== ctx.userId) {
    return { error: "You can only publish gigs at venues you own." };
  }

  const status = venue.owner_id ? "approved" : "pending";

  const { data: genres } = await sb.from("genres").select("id, slug");
  const genreSlugToId = new Map<string, string>();
  for (const g of genres ?? []) genreSlugToId.set(g.slug, g.id);

  // Look up existing events at this venue. Match a draft to an existing event
  // when same start hour AND (same/similar title, OR no other conflict in that hour).
  // For poster uploads we surface ANY same-hour same-venue collision so the user
  // can choose — even if the titles are different, that's almost certainly a clash.
  const { data: existingEvents } = await sb
    .from("events")
    .select("id, title, start_time, image_url, description, auto_imported_from")
    .eq("venue_id", opts.venueId)
    .neq("status", "rejected");

  const byHour = new Map<string, ConflictExisting[]>();
  for (const e of existingEvents ?? []) {
    const hk = hourKey(e.start_time);
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

  const conflicts: PosterConflict[] = [];
  const draftConflictMap = new Map<number, ConflictExisting>();
  for (let i = 0; i < opts.drafts.length; i++) {
    const d = opts.drafts[i];
    const hk = hourKey(d.starts_at);
    const sameHour = byHour.get(hk) ?? [];
    if (sameHour.length === 0) continue;
    // Prefer title match within the hour, else just take the first
    const nt = normTitle(d.title);
    const titleMatch = sameHour.find((e) => {
      const en = normTitle(e.title);
      if (en === nt) return true;
      if (nt.length >= 6 && en.length >= 6 && (en.includes(nt) || nt.includes(en))) return true;
      return false;
    });
    const match = titleMatch ?? sameHour[0];
    conflicts.push({
      draftIdx: i,
      draftTitle: d.title,
      draftStart: d.starts_at,
      existing: match,
    });
    draftConflictMap.set(i, match);
  }

  const resolutions = opts.resolutions ?? {};
  const unresolved = conflicts.filter((c) => !resolutions[c.draftIdx]);
  if (unresolved.length > 0) {
    return { conflicts: unresolved };
  }

  // Apply resolutions:
  // - "skip"      → drop draft from insert list
  // - "replace"   → delete existing event (cascade), then insert
  // - "keep_both" → insert alongside (default for non-conflicting drafts)
  const replaceIds: string[] = [];
  const skipIdxs = new Set<number>();
  for (const c of conflicts) {
    const r = resolutions[c.draftIdx];
    if (r === "skip") skipIdxs.add(c.draftIdx);
    else if (r === "replace") replaceIds.push(c.existing.id);
  }

  if (replaceIds.length > 0) {
    // Hard-delete the events being replaced. Cascading FKs handle event_artists/event_genres.
    await sb.from("event_artists").delete().in("event_id", replaceIds);
    await sb.from("event_genres").delete().in("event_id", replaceIds);
    await sb.from("events").delete().in("id", replaceIds);
  }

  // Track original draft index so we can map back for genre/artist links after insert.
  const draftsToInsert: { idx: number; d: DraftEvent }[] = [];
  for (let i = 0; i < opts.drafts.length; i++) {
    if (skipIdxs.has(i)) continue;
    draftsToInsert.push({ idx: i, d: opts.drafts[i] });
  }

  if (draftsToInsert.length === 0) {
    return {
      ok: true,
      published: 0,
      pending: false,
      replaced: replaceIds.length,
      skipped: skipIdxs.size,
    };
  }

  const eventRows = draftsToInsert.map(({ d }) => ({
    venue_id: opts.venueId,
    title: d.title.trim().slice(0, 200),
    start_time: d.starts_at,
    end_time: d.ends_at,
    description: (d.description ?? "").trim().slice(0, 2000),
    status,
    submitted_by: ctx.userId,
    auto_imported_from: "manual_upload",
    auto_import_confidence: d.confidence,
    auto_import_image_url: opts.posterImageUrl,
    image_url: opts.posterImageUrl,
  }));

  const { data: created, error: insErr } = await sb
    .from("events")
    .insert(eventRows)
    .select("id");
  if (insErr) return { error: `Failed to create events: ${insErr.message}` };
  if (!created || created.length === 0) return { error: "No events created." };

  // Persist the poster to our storage bucket so the URL doesn't die when
  // the temp upload URL expires. Save it once per batch using the first
  // event ID as the storage key — all events in this batch share the poster.
  const firstId = created[0].id;
  const stored = await uploadPosterFromUrl(sb, {
    sourceUrl: opts.posterImageUrl,
    eventId: firstId,
  });
  if ("ok" in stored) {
    const ids = created.map((c) => c.id);
    await sb.from("events")
      .update({ image_url: stored.publicUrl, auto_import_image_url: stored.publicUrl })
      .in("id", ids);
  }

  // Wire up event_genres — note we iterate `draftsToInsert`, not `opts.drafts`,
  // because skipped drafts aren't in `created`.
  const genreLinks: { event_id: string; genre_id: string }[] = [];
  draftsToInsert.forEach(({ d }, i) => {
    const eventId = created[i]?.id;
    if (!eventId) return;
    for (const slug of d.genres) {
      const gid = genreSlugToId.get(slug);
      if (gid) genreLinks.push({ event_id: eventId, genre_id: gid });
    }
  });
  if (genreLinks.length > 0) {
    await sb.from("event_genres").insert(genreLinks);
  }

  // Wire up artists (find or create), then link via event_artists
  const allArtistNames = Array.from(new Set(draftsToInsert.flatMap(({ d }) => d.artists)))
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 80);
  if (allArtistNames.length > 0) {
    const nameToId = await resolveOrCreateArtists(sb, allArtistNames, venue.city_id ?? null);
    const artistLinks: { event_id: string; artist_id: string }[] = [];
    draftsToInsert.forEach(({ d }, i) => {
      const eventId = created[i]?.id;
      if (!eventId) return;
      for (const name of d.artists) {
        const aid = nameToId.get(normaliseArtistName(name));
        if (aid) artistLinks.push({ event_id: eventId, artist_id: aid });
      }
    });
    if (artistLinks.length > 0) {
      await sb.from("event_artists").upsert(artistLinks, {
        onConflict: "event_id,artist_id",
        ignoreDuplicates: true,
      });
    }
  }

  if (status === "approved") {
    const citySlug = (venue.city as any)?.slug ?? "dundee";
    revalidatePath(`/${citySlug}/venues/${venue.slug}`);
    revalidatePath(`/${citySlug}`);
  }
  revalidatePath("/admin/queue");

  return {
    ok: true,
    published: created.length,
    pending: status === "pending",
    replaced: replaceIds.length,
    skipped: skipIdxs.size,
  };
}

function normaliseArtistName(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/^the\s+/i, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function slugifyArtist(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

async function resolveOrCreateArtists(
  sb: ReturnType<typeof createServiceClient>,
  names: string[],
  cityId: string | null,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const cleaned = names.map((n) => n.trim()).filter((n) => n.length > 0 && n.length <= 80);
  if (cleaned.length === 0) return out;

  const normalised = Array.from(new Set(cleaned.map(normaliseArtistName))).filter(Boolean);
  if (normalised.length === 0) return out;

  const orFilter = cleaned
    .slice(0, 30)
    .map((n) => `name.ilike.${n.replace(/[\\,()]/g, " ").trim().replace(/\s+/g, " ")}`)
    .join(",");
  if (orFilter) {
    const { data: existing } = await sb.from("artists").select("id, name").or(orFilter);
    for (const a of existing ?? []) {
      const key = normaliseArtistName(a.name);
      if (normalised.includes(key) && !out.has(key)) out.set(key, a.id);
    }
  }

  for (const name of cleaned) {
    const key = normaliseArtistName(name);
    if (out.has(key)) continue;
    const baseSlug = slugifyArtist(name);
    if (!baseSlug) continue;
    let slug = baseSlug;
    for (let i = 0; i < 5; i++) {
      const { data: created, error } = await sb
        .from("artists")
        .insert({ name, slug, city_id: cityId, approved: true })
        .select("id")
        .single();
      if (!error && created) {
        out.set(key, created.id);
        break;
      }
      if (error?.code === "23505") {
        slug = `${baseSlug}-${i + 2}`;
        continue;
      }
      break;
    }
  }
  return out;
}
