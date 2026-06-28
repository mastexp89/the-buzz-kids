"use server";

// Admin server actions for managing festivals (e.g. Dundee Music Festival).
// All actions require admin role.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
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

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export type FestivalRow = {
  id: string;
  name: string;
  slug: string;
  start_date: string;
  end_date: string;
  hero_image_url: string | null;
  hero_image_position: string;
  // 0.00–1.00 opacity for the blurred hero backdrop. NULL on rows
  // pre-sql/055; treated as 0.5 by the public page.
  hero_image_opacity: number | null;
  // Blur in pixels (0–40). NULL on rows pre-sql/055; treated as 24.
  hero_image_blur: number | null;
  logo_url: string | null;
  map_image_url: string | null;
  // Legacy: pointed at the shared sponsors table. Replaced by the three
  // standalone sponsor_name / sponsor_logo_url / sponsor_url columns.
  // Kept on the row type so existing rows don't break TypeScript, but
  // the admin form no longer touches it.
  sponsor_id: string | null;
  sponsor_name: string | null;
  sponsor_logo_url: string | null;
  sponsor_url: string | null;
  contact_email: string | null;
  accepting_artists: boolean;
  primary_color: string | null;
  sponsor_text: string | null;
  ticket_url: string | null;
  description: string | null;
  tagline: string | null;
  published: boolean;
  // Display overrides — when set, the public landing shows these labels
  // instead of the live counts. Useful pre-lineup when "0 acts" would be wrong.
  act_count_label: string | null;
  venue_count_label: string | null;
  // Page layout. 'multi_venue' (default) = classic Schedule/Venues/Artists/Map
  // tabs. 'programme' = single-park festivals: Programme tab with markdown,
  // no Venues/Map tabs. NULL on existing rows is treated as 'multi_venue'.
  layout_mode: "multi_venue" | "programme" | null;
  // Long-form markdown for the Programme tab. Only meaningful when
  // layout_mode = 'programme'.
  programme_content: string | null;
  // Opaque token for sharing an unpublished festival preview URL
  preview_token: string | null;
  venue_count?: number;
};

export type FestivalVenueRow = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  approved: boolean;
  sort_order: number;
};

// All active sponsors — for the festival admin sponsor picker. Sorted by
// name so the dropdown is easy to scan.
export async function listActiveSponsors(): Promise<{ id: string; name: string; tier: string }[]> {
  if (!(await requireAdmin())) return [];
  const sb = createServiceClient();
  const { data } = await sb
    .from("sponsors")
    .select("id, name, tier")
    .eq("status", "active")
    .order("name");
  return (data ?? []).map((s: any) => ({ id: s.id, name: s.name, tier: s.tier }));
}

export async function listFestivals(): Promise<FestivalRow[]> {
  if (!(await requireAdmin())) return [];
  const sb = createServiceClient();
  const { data: festivals } = await sb
    .from("festivals")
    .select("*")
    .order("start_date", { ascending: false });
  if (!festivals) return [];
  // Count venues per festival in one extra query
  const ids = festivals.map((f) => f.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: rows } = await sb
      .from("festival_venues")
      .select("festival_id")
      .in("festival_id", ids);
    for (const r of rows ?? []) {
      counts.set(r.festival_id, (counts.get(r.festival_id) ?? 0) + 1);
    }
  }
  return festivals.map((f: any) => ({ ...f, venue_count: counts.get(f.id) ?? 0 }));
}

export async function getFestivalWithVenues(
  id: string,
): Promise<{ festival: FestivalRow; venues: FestivalVenueRow[] } | null> {
  if (!(await requireAdmin())) return null;
  const sb = createServiceClient();
  const { data: festival } = await sb
    .from("festivals")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!festival) return null;
  const { data: rows } = await sb
    .from("festival_venues")
    .select("sort_order, venues(id, name, slug, approved, city:cities(name))")
    .eq("festival_id", id)
    .order("sort_order");
  const venues: FestivalVenueRow[] = (rows ?? []).map((r: any) => ({
    id: r.venues.id,
    name: r.venues.name,
    slug: r.venues.slug,
    city: r.venues.city?.name ?? null,
    approved: r.venues.approved,
    sort_order: r.sort_order ?? 0,
  }));
  return { festival, venues };
}

export type CreateFestivalInput = {
  name: string;
  slug?: string;
  start_date: string;
  end_date: string;
  description?: string;
  tagline?: string;
  primary_color?: string;
  hero_image_url?: string;
  hero_image_position?: string;
  hero_image_opacity?: number;
  hero_image_blur?: number;
  logo_url?: string;
  map_image_url?: string;
  sponsor_id?: string | null; // legacy — see FestivalRow
  sponsor_name?: string;
  sponsor_logo_url?: string;
  sponsor_url?: string;
  contact_email?: string;
  accepting_artists?: boolean;
  sponsor_text?: string;
  ticket_url?: string;
  act_count_label?: string;
  venue_count_label?: string;
  layout_mode?: "multi_venue" | "programme";
  programme_content?: string;
  published?: boolean;
};

export async function createFestival(
  input: CreateFestivalInput,
): Promise<{ ok: true; id: string; slug: string } | { error: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const name = input.name.trim();
  if (!name) return { error: "Name is required." };
  if (!input.start_date || !input.end_date) return { error: "Start and end dates required." };

  const sb = createServiceClient();
  let slug = (input.slug ?? slugify(name)) || slugify(name);
  // Ensure unique
  for (let i = 0; i < 5; i++) {
    const { data: existing } = await sb.from("festivals").select("id").eq("slug", slug).maybeSingle();
    if (!existing) break;
    slug = `${slugify(name)}-${i + 2}`;
  }

  const { data: created, error } = await sb
    .from("festivals")
    .insert({
      name,
      slug,
      start_date: input.start_date,
      end_date: input.end_date,
      description: input.description?.trim() || null,
      tagline: input.tagline?.trim() || null,
      primary_color: input.primary_color || "#e91e63",
      hero_image_url: input.hero_image_url?.trim() || null,
      sponsor_text: input.sponsor_text?.trim() || null,
      ticket_url: input.ticket_url?.trim() || null,
      published: !!input.published,
    })
    .select("id, slug")
    .single();
  if (error || !created) return { error: error?.message ?? "Insert failed" };

  revalidatePath("/admin/festivals");
  return { ok: true, id: created.id, slug: created.slug };
}

export async function updateFestival(
  id: string,
  patch: Partial<CreateFestivalInput>,
): Promise<{ ok: true } | { error: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();
  const cleaned: Record<string, any> = {};
  if (patch.name !== undefined) cleaned.name = patch.name.trim();
  if (patch.start_date !== undefined) cleaned.start_date = patch.start_date;
  if (patch.end_date !== undefined) cleaned.end_date = patch.end_date;
  if (patch.description !== undefined) cleaned.description = patch.description.trim() || null;
  if (patch.tagline !== undefined) cleaned.tagline = patch.tagline.trim() || null;
  if (patch.primary_color !== undefined) cleaned.primary_color = patch.primary_color || null;
  if (patch.hero_image_url !== undefined) cleaned.hero_image_url = patch.hero_image_url.trim() || null;
  if (patch.hero_image_position !== undefined) cleaned.hero_image_position = patch.hero_image_position.trim() || "center";
  if (patch.hero_image_opacity !== undefined) {
    // Clamp to [0, 1] — the DB has a CHECK constraint but doing it here
    // means we never bounce a save off a slider misfiring (e.g. NaN).
    const raw = Number(patch.hero_image_opacity);
    const safe = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.5;
    cleaned.hero_image_opacity = Math.round(safe * 100) / 100; // 2 dp
  }
  if (patch.hero_image_blur !== undefined) {
    // Clamp to [0, 40] integer px. CSS accepts decimal blur values, but
    // we keep this as an int so the DB column type can be smallint
    // (smaller, faster) and the slider step is whole-pixel.
    const raw = Number(patch.hero_image_blur);
    const safe = Number.isFinite(raw) ? Math.max(0, Math.min(40, Math.round(raw))) : 24;
    cleaned.hero_image_blur = safe;
  }
  if (patch.logo_url !== undefined) cleaned.logo_url = patch.logo_url.trim() || null;
  if (patch.map_image_url !== undefined) cleaned.map_image_url = patch.map_image_url.trim() || null;
  if (patch.sponsor_id !== undefined) cleaned.sponsor_id = patch.sponsor_id || null;
  if (patch.sponsor_name !== undefined) cleaned.sponsor_name = patch.sponsor_name.trim() || null;
  if (patch.sponsor_logo_url !== undefined) cleaned.sponsor_logo_url = patch.sponsor_logo_url.trim() || null;
  if (patch.sponsor_url !== undefined) cleaned.sponsor_url = patch.sponsor_url.trim() || null;
  if (patch.contact_email !== undefined) cleaned.contact_email = patch.contact_email.trim() || null;
  if (patch.accepting_artists !== undefined) cleaned.accepting_artists = !!patch.accepting_artists;
  if (patch.sponsor_text !== undefined) cleaned.sponsor_text = patch.sponsor_text.trim() || null;
  if (patch.ticket_url !== undefined) cleaned.ticket_url = patch.ticket_url.trim() || null;
  if (patch.act_count_label !== undefined) cleaned.act_count_label = patch.act_count_label.trim() || null;
  if (patch.venue_count_label !== undefined) cleaned.venue_count_label = patch.venue_count_label.trim() || null;
  if (patch.layout_mode !== undefined) {
    // Defensive validation — the DB has a CHECK constraint, but reject
    // junk early so the error message is clearer than "constraint failed".
    cleaned.layout_mode = patch.layout_mode === "programme" ? "programme" : "multi_venue";
  }
  if (patch.programme_content !== undefined) cleaned.programme_content = patch.programme_content.trim() || null;
  if (patch.published !== undefined) cleaned.published = !!patch.published;

  if (Object.keys(cleaned).length === 0) return { ok: true };

  const { data: row } = await sb.from("festivals").select("slug").eq("id", id).maybeSingle();
  const { error } = await sb.from("festivals").update(cleaned).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/festivals");
  revalidatePath(`/admin/festivals/${id}`);
  if (row?.slug) revalidatePath(`/festivals/${row.slug}`);
  return { ok: true };
}

// Regenerate the preview token — useful if a previously-shared preview URL
// has been forwarded too widely or you want to "expire" it.
export async function regenerateFestivalPreviewToken(id: string): Promise<{ ok: true; token: string } | { error: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();
  // Postgres handles the new UUID via DEFAULT
  const { data, error } = await sb
    .from("festivals")
    .update({ preview_token: null })
    .eq("id", id)
    .select("preview_token")
    .maybeSingle();
  if (error) return { error: error.message };
  // The default fires only on INSERT, so explicitly assign one
  const newToken = crypto.randomUUID();
  const { error: e2 } = await sb.from("festivals").update({ preview_token: newToken }).eq("id", id);
  if (e2) return { error: e2.message };
  revalidatePath(`/admin/festivals/${id}`);
  return { ok: true, token: newToken };
}

export async function deleteFestival(id: string): Promise<{ ok: true } | { error: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();
  // ON DELETE CASCADE handles festival_venues
  const { error } = await sb.from("festivals").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/festivals");
  return { ok: true };
}

// ---- Lineup (typed-in artists with times + stage) ---------------------------

export type FestivalLineupRow = {
  id: string;
  artist_id: string;
  artist_name: string;
  artist_slug: string;
  artist_image_url: string | null;
  performance_time: string | null; // ISO timestamp, NULL = TBA
  stage: string | null;
  sort_order: number;
};

export async function listFestivalLineup(
  festivalId: string,
): Promise<FestivalLineupRow[]> {
  if (!(await requireAdmin())) return [];
  const sb = createServiceClient();
  const { data } = await sb
    .from("festival_lineup")
    .select("id, artist_id, performance_time, stage, sort_order, artist:artists(name, slug, image_url)")
    .eq("festival_id", festivalId)
    .order("performance_time", { ascending: true, nullsFirst: false })
    .order("sort_order", { ascending: true });
  return (data ?? []).map((r: any) => ({
    id: r.id,
    artist_id: r.artist_id,
    artist_name: r.artist?.name ?? "(unknown)",
    artist_slug: r.artist?.slug ?? "",
    artist_image_url: r.artist?.image_url ?? null,
    performance_time: r.performance_time,
    stage: r.stage,
    sort_order: r.sort_order ?? 0,
  }));
}

/**
 * Add an act to a festival's lineup. If an artist with the same
 * (normalised) name already exists, link to that row; otherwise
 * create a new `artists` row with an auto-generated slug.
 *
 * Returns the new lineup row so the admin UI can append it without
 * a refetch.
 */
export async function addFestivalLineupAct(input: {
  festivalId: string;
  name: string;
  performance_time?: string | null; // ISO datetime, or null/undefined for TBA
  stage?: string | null;
}): Promise<{ ok: true; row: FestivalLineupRow } | { error: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };

  const name = (input.name ?? "").trim();
  if (!name) return { error: "Artist name is required." };
  if (name.length > 200) return { error: "Artist name too long (max 200 chars)." };

  const sb = createServiceClient();

  // Find-or-create the artist. We match on slug rather than free-text
  // name so "The Castros" and "the castros" reach the same row, but
  // intentionally distinct names ("Sergeant" vs "Sergeants") stay
  // separate.
  const slugCandidate = slugify(name) || "act";
  let artistId: string | null = null;

  const { data: existing } = await sb
    .from("artists")
    .select("id")
    .eq("slug", slugCandidate)
    .maybeSingle();
  if (existing) {
    artistId = existing.id;
  } else {
    // Unique-slug suffixing — handles two acts that happen to slugify
    // identically (rare but possible: "The Castros!" and "The Castros").
    let slug = slugCandidate;
    for (let i = 0; i < 5 && !artistId; i++) {
      const { data: ins, error } = await sb
        .from("artists")
        .insert({ name, slug, approved: true })
        .select("id")
        .single();
      if (ins) {
        artistId = ins.id;
        break;
      }
      // Slug collision (race) → try with a numeric suffix
      if (error?.code === "23505") {
        slug = `${slugCandidate}-${i + 2}`;
        continue;
      }
      return { error: `Couldn't create artist: ${error?.message ?? "unknown"}` };
    }
    if (!artistId) return { error: "Couldn't find a free slug for this artist." };
  }

  // Insert the lineup row
  const performanceTime = input.performance_time?.trim() || null;
  const stage = (input.stage ?? "").trim() || null;
  const { data: lineup, error: insErr } = await sb
    .from("festival_lineup")
    .insert({
      festival_id: input.festivalId,
      artist_id: artistId,
      performance_time: performanceTime,
      stage,
    })
    .select("id, artist_id, performance_time, stage, sort_order, artist:artists(name, slug, image_url)")
    .single();
  if (insErr || !lineup) return { error: insErr?.message ?? "Insert failed." };

  // Revalidate the public festival page so the lineup appears immediately
  const { data: fest } = await sb.from("festivals").select("slug").eq("id", input.festivalId).maybeSingle();
  revalidatePath(`/admin/festivals/${input.festivalId}`);
  if (fest?.slug) revalidatePath(`/festivals/${fest.slug}`);

  const row: FestivalLineupRow = {
    id: lineup.id,
    artist_id: lineup.artist_id,
    artist_name: (lineup as any).artist?.name ?? name,
    artist_slug: (lineup as any).artist?.slug ?? slugCandidate,
    artist_image_url: (lineup as any).artist?.image_url ?? null,
    performance_time: lineup.performance_time,
    stage: lineup.stage,
    sort_order: lineup.sort_order ?? 0,
  };
  return { ok: true, row };
}

/**
 * Update an existing lineup row's time / stage (NOT the artist —
 * delete + re-add to swap that). Used by the inline-edit UI.
 */
export async function updateFestivalLineupAct(
  id: string,
  patch: { performance_time?: string | null; stage?: string | null },
): Promise<{ ok: true } | { error: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();
  const cleaned: Record<string, any> = {};
  if (patch.performance_time !== undefined) {
    cleaned.performance_time = patch.performance_time?.trim() || null;
  }
  if (patch.stage !== undefined) {
    cleaned.stage = patch.stage?.trim() || null;
  }
  if (Object.keys(cleaned).length === 0) return { ok: true };

  const { data: existing } = await sb
    .from("festival_lineup")
    .select("festival_id, festivals(slug)")
    .eq("id", id)
    .maybeSingle();
  const { error } = await sb.from("festival_lineup").update(cleaned).eq("id", id);
  if (error) return { error: error.message };

  if (existing) {
    revalidatePath(`/admin/festivals/${(existing as any).festival_id}`);
    const fs = (existing as any).festivals?.slug;
    if (fs) revalidatePath(`/festivals/${fs}`);
  }
  return { ok: true };
}

export async function deleteFestivalLineupAct(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();

  const { data: existing } = await sb
    .from("festival_lineup")
    .select("festival_id, festivals(slug)")
    .eq("id", id)
    .maybeSingle();
  const { error } = await sb.from("festival_lineup").delete().eq("id", id);
  if (error) return { error: error.message };

  if (existing) {
    revalidatePath(`/admin/festivals/${(existing as any).festival_id}`);
    const fs = (existing as any).festivals?.slug;
    if (fs) revalidatePath(`/festivals/${fs}`);
  }
  return { ok: true };
}

// ---- Venue assignment -------------------------------------------------------

export type VenueSearchResult = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  approved: boolean;
  alreadyAssigned: boolean;
};

export async function searchVenuesForFestival(
  festivalId: string,
  query: string,
): Promise<VenueSearchResult[]> {
  if (!(await requireAdmin())) return [];
  const sb = createServiceClient();
  const q = query.trim();
  let req = sb
    .from("venues")
    .select("id, name, slug, approved, city:cities(name)")
    .order("name")
    .limit(20);
  if (q.length > 0) req = req.ilike("name", `%${q.replace(/[%_]/g, "")}%`);
  const { data: venues } = await req;

  // Find which are already assigned to this festival
  const ids = (venues ?? []).map((v: any) => v.id);
  let assigned = new Set<string>();
  if (ids.length > 0) {
    const { data: links } = await sb
      .from("festival_venues")
      .select("venue_id")
      .eq("festival_id", festivalId)
      .in("venue_id", ids);
    assigned = new Set((links ?? []).map((l: any) => l.venue_id));
  }
  return (venues ?? []).map((v: any) => ({
    id: v.id,
    name: v.name,
    slug: v.slug,
    city: v.city?.name ?? null,
    approved: v.approved,
    alreadyAssigned: assigned.has(v.id),
  }));
}

export async function addVenueToFestival(
  festivalId: string,
  venueId: string,
): Promise<{ ok: true } | { error: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();
  const { error } = await sb
    .from("festival_venues")
    .upsert({ festival_id: festivalId, venue_id: venueId }, { onConflict: "festival_id,venue_id", ignoreDuplicates: true });
  if (error) return { error: error.message };
  const { data: f } = await sb.from("festivals").select("slug").eq("id", festivalId).maybeSingle();
  revalidatePath(`/admin/festivals/${festivalId}`);
  if (f?.slug) revalidatePath(`/festivals/${f.slug}`);
  return { ok: true };
}

export async function removeVenueFromFestival(
  festivalId: string,
  venueId: string,
): Promise<{ ok: true } | { error: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();
  const { error } = await sb
    .from("festival_venues")
    .delete()
    .eq("festival_id", festivalId)
    .eq("venue_id", venueId);
  if (error) return { error: error.message };
  const { data: f } = await sb.from("festivals").select("slug").eq("id", festivalId).maybeSingle();
  revalidatePath(`/admin/festivals/${festivalId}`);
  if (f?.slug) revalidatePath(`/festivals/${f.slug}`);
  return { ok: true };
}

// Scrape a venue's website to fill in contact details, address, social links,
// and cover photo. Best-effort: skips fields we can't confidently fill, never
// overwrites values that are already set on the venue.
//
// Used:
//  1. Right after `createVenueAndLinkToFestival` if a website was provided
//  2. As an "Auto-fill from website" button on existing venue edit pages
export type EnrichResult =
  | { ok: true; populated: string[]; skipped: string[]; warnings: string[] }
  | { error: string };

export async function enrichVenueFromWebsite(venueId: string, websiteUrl?: string): Promise<EnrichResult> {
  if (!(await requireAdmin())) return { error: "Admins only." };

  const sb = createServiceClient();
  const { data: v } = await sb
    .from("venues")
    .select("id, name, website, address, postcode, phone, email, description, facebook, instagram, twitter, tiktok, youtube, spotify, latitude, longitude, cover_photo_url")
    .eq("id", venueId)
    .maybeSingle();
  if (!v) return { error: "Venue not found." };

  const url = websiteUrl?.trim() || v.website;
  if (!url) return { error: "No website URL on this venue (and none passed in). Set the website first." };

  // Lazy import — these are server-side only and pull in heavy modules
  const { scrapeVenueWebsite } = await import("@/lib/scrape-website");
  const { extractVenueInfo } = await import("@/lib/extraction");
  const { geocodePostcode } = await import("@/lib/geocode");

  const scrape = await scrapeVenueWebsite(url);
  const warnings: string[] = scrape.errors.slice(0, 3);
  if (scrape.pages.length === 0) {
    return { ok: true, populated: [], skipped: [], warnings: ["Couldn't fetch any usable pages from that URL."] };
  }

  // Concatenate text from up to 3 pages (cap to keep AI input reasonable)
  const text = scrape.pages
    .slice(0, 3)
    .map((p) => `--- ${p.url} ---\n${p.text}`)
    .join("\n\n");

  let info;
  try {
    info = await extractVenueInfo({ venueName: v.name, pageText: text });
  } catch (e: any) {
    return { error: `AI extraction failed: ${e?.message ?? "unknown"}` };
  }

  // Build update patch — never overwrite existing values, only fill blanks.
  const patch: Record<string, any> = {};
  const populated: string[] = [];
  const skipped: string[] = [];

  function maybeSet(field: string, current: any, next: any) {
    if (next == null || next === "") {
      skipped.push(`${field} (not found)`);
      return;
    }
    if (current && typeof current === "string" && current.trim().length > 0) {
      skipped.push(`${field} (already set)`);
      return;
    }
    patch[field] = next;
    populated.push(field);
  }

  maybeSet("address", v.address, info.address);
  maybeSet("postcode", v.postcode, info.postcode);
  maybeSet("phone", v.phone, info.phone);
  maybeSet("email", v.email, info.email);
  maybeSet("description", v.description, info.description);

  // Socials from the scraper (regex-based, no AI cost)
  maybeSet("facebook", v.facebook, scrape.socials.facebook ?? null);
  maybeSet("instagram", v.instagram, scrape.socials.instagram ?? null);
  maybeSet("twitter", v.twitter, scrape.socials.twitter ?? null);
  maybeSet("tiktok", v.tiktok, scrape.socials.tiktok ?? null);
  maybeSet("youtube", v.youtube, scrape.socials.youtube ?? null);
  maybeSet("spotify", v.spotify, scrape.socials.spotify ?? null);

  // Cover photo — first available image from the homepage (already prioritised
  // og:image > twitter:image > featured > content imgs by extractImageUrls)
  if (!v.cover_photo_url) {
    const homepageImages = scrape.pages[0]?.imageUrls ?? [];
    if (homepageImages[0]) {
      patch.cover_photo_url = homepageImages[0];
      populated.push("cover_photo_url");
    }
  }

  // Geocode if we now have a postcode but no lat/lng
  if (patch.postcode && (v.latitude == null || v.longitude == null)) {
    try {
      const ll = await geocodePostcode(patch.postcode);
      if (ll) {
        patch.latitude = ll.lat;
        patch.longitude = ll.lng;
        populated.push("latitude/longitude");
      }
    } catch { /* ignore */ }
  }

  // Persist website itself if it wasn't already on the venue
  if (!v.website && url) {
    patch.website = url;
    populated.push("website");
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await sb.from("venues").update(patch).eq("id", venueId);
    if (error) return { error: `Update failed: ${error.message}` };
  }

  return { ok: true, populated, skipped, warnings };
}

// Search for venues that *could* match a given name — used by the unmatched
// list so admin can manually pick the right venue when fuzzy match missed.
// Returns top 10 candidates ordered by closest name match.
export async function searchExistingVenuesForName(
  festivalId: string,
  name: string,
): Promise<VenueSearchResult[]> {
  if (!(await requireAdmin())) return [];
  const trimmed = name.trim();
  if (!trimmed) return [];
  const sb = createServiceClient();
  // Aggressive match: search by raw name, also strip "the " prefix,
  // also strip trailing " bar/pub/club" suffix.
  const variants = Array.from(new Set([
    trimmed,
    trimmed.replace(/^the\s+/i, ""),
    trimmed.replace(/\s+(bar|pub|club|hotel|tavern|inn|lounge|live)\s*$/i, ""),
    trimmed.replace(/^the\s+/i, "").replace(/\s+(bar|pub|club|hotel|tavern|inn|lounge|live)\s*$/i, ""),
  ]));
  const seen = new Set<string>();
  const collected: any[] = [];
  for (const v of variants) {
    const safe = v.replace(/[%_]/g, "").slice(0, 60).trim();
    if (!safe) continue;
    const { data } = await sb
      .from("venues")
      .select("id, name, slug, approved, city:cities(name)")
      .ilike("name", `%${safe}%`)
      .limit(10);
    for (const row of data ?? []) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        collected.push(row);
      }
    }
    if (collected.length >= 10) break;
  }
  // Mark which are already assigned to this festival
  const ids = collected.map((c) => c.id);
  let assigned = new Set<string>();
  if (ids.length > 0) {
    const { data: links } = await sb
      .from("festival_venues")
      .select("venue_id")
      .eq("festival_id", festivalId)
      .in("venue_id", ids);
    assigned = new Set((links ?? []).map((l: any) => l.venue_id));
  }
  return collected.slice(0, 10).map((v: any) => ({
    id: v.id,
    name: v.name,
    slug: v.slug,
    city: v.city?.name ?? null,
    approved: v.approved,
    alreadyAssigned: assigned.has(v.id),
  }));
}

// Create a new venue (admin shortcut) AND link it to the festival in one step.
// Sensible defaults: city = Dundee (or whatever cityId is passed), approved =
// true, auto_imported = true. Optional fields populate what we can: facebook +
// website hints kick off cover-photo backfill on the next FB cron, and a
// postcode triggers geocoding for the map.
export async function createVenueAndLinkToFestival(opts: {
  festivalId: string;
  name: string;
  facebookUrl?: string | null;
  website?: string | null;
  address?: string | null;
  postcode?: string | null;
  cityId?: string | null;
}): Promise<{ ok: true; venueId: string; venueSlug: string; geocoded: boolean } | { error: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const name = opts.name.trim();
  if (!name) return { error: "Name is required." };

  const sb = createServiceClient();

  // Resolve city — default to Dundee if not provided
  let cityId = opts.cityId ?? null;
  if (!cityId) {
    const { data: dundee } = await sb.from("cities").select("id").eq("slug", "dundee").maybeSingle();
    cityId = dundee?.id ?? null;
  }

  // Optional postcode → lat/lng via postcodes.io (free, UK-only, no key)
  let latitude: number | null = null;
  let longitude: number | null = null;
  let geocoded = false;
  const postcode = opts.postcode?.trim() || null;
  if (postcode) {
    try {
      const { geocodePostcode } = await import("@/lib/geocode");
      const ll = await geocodePostcode(postcode);
      if (ll) {
        latitude = ll.lat;
        longitude = ll.lng;
        geocoded = true;
      }
    } catch { /* swallow — geo is best-effort */ }
  }

  // Generate unique slug
  const baseSlug = slugify(name) || "venue";
  let slug = baseSlug;
  let venue: any = null;
  for (let i = 0; i < 5; i++) {
    const { data: created, error } = await sb
      .from("venues")
      .insert({
        name,
        slug,
        city_id: cityId,
        approved: true,
        auto_imported: true,
        facebook: opts.facebookUrl?.trim() || null,
        website: opts.website?.trim() || null,
        address: opts.address?.trim() || null,
        postcode,
        latitude,
        longitude,
      })
      .select("id, slug")
      .single();
    if (!error && created) {
      venue = created;
      break;
    }
    if (error?.code === "23505") {
      slug = `${baseSlug}-${i + 2}`;
      continue;
    }
    return { error: `Couldn't create venue: ${error?.message ?? "unknown"}` };
  }
  if (!venue) return { error: "Couldn't generate a unique slug." };

  // Link to festival
  const { error: linkErr } = await sb
    .from("festival_venues")
    .upsert({ festival_id: opts.festivalId, venue_id: venue.id }, { onConflict: "festival_id,venue_id", ignoreDuplicates: true });
  if (linkErr) return { error: `Created venue but failed to link to festival: ${linkErr.message}` };

  const { data: f } = await sb.from("festivals").select("slug").eq("id", opts.festivalId).maybeSingle();
  revalidatePath(`/admin/festivals/${opts.festivalId}`);
  if (f?.slug) revalidatePath(`/festivals/${f.slug}`);

  return { ok: true, venueId: venue.id, venueSlug: venue.slug, geocoded };
}

// Bulk add by name list — fuzzy-matches the names against existing venues.
// Returns matched / unmatched so admin can see what got linked. Also returns
// the full updated venue list for this festival so the client can replace
// local state without reloading the whole page.
export async function bulkAddVenuesByName(
  festivalId: string,
  names: string[],
): Promise<{
  ok: true;
  matched: { input: string; venueName: string }[];
  unmatched: string[];
  venues: FestivalVenueRow[];
} | { error: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();
  const cleaned = names.map((n) => n.trim()).filter((n) => n.length > 0);
  const matched: { input: string; venueName: string }[] = [];
  const unmatched: string[] = [];

  for (const input of cleaned) {
    // Normalised matching: drop "the " prefix and " bar/pub/club/hotel" suffix
    const norm = (s: string) =>
      s.toLowerCase()
        .replace(/^the\s+/, "")
        .replace(/\s+(bar|pub|club|hotel|tavern|inn|lounge|live)\s*$/i, "")
        .replace(/['']/g, "")
        .trim();
    const target = norm(input);
    // Search both raw and normalised forms
    const { data: candidates } = await sb
      .from("venues")
      .select("id, name")
      .ilike("name", `%${input.replace(/[%_]/g, "").slice(0, 60)}%`)
      .limit(10);
    let venueId: string | null = null;
    let venueName: string | null = null;
    for (const c of candidates ?? []) {
      const cn = norm(c.name);
      if (cn === target || cn.includes(target) || target.includes(cn)) {
        venueId = c.id;
        venueName = c.name;
        break;
      }
    }
    if (venueId) {
      await sb.from("festival_venues")
        .upsert({ festival_id: festivalId, venue_id: venueId }, { onConflict: "festival_id,venue_id", ignoreDuplicates: true });
      matched.push({ input, venueName: venueName! });
    } else {
      unmatched.push(input);
    }
  }

  // Fetch the new full venue list so the client can re-render without reload
  const { data: rows } = await sb
    .from("festival_venues")
    .select("sort_order, venues(id, name, slug, approved, city:cities(name))")
    .eq("festival_id", festivalId)
    .order("sort_order");
  const venues: FestivalVenueRow[] = (rows ?? []).map((r: any) => ({
    id: r.venues.id,
    name: r.venues.name,
    slug: r.venues.slug,
    city: r.venues.city?.name ?? null,
    approved: r.venues.approved,
    sort_order: r.sort_order ?? 0,
  }));

  const { data: f } = await sb.from("festivals").select("slug").eq("id", festivalId).maybeSingle();
  revalidatePath(`/admin/festivals/${festivalId}`);
  if (f?.slug) revalidatePath(`/festivals/${f.slug}`);
  return { ok: true, matched, unmatched, venues };
}

// ---- Extra sponsors (the "with thanks to" grid) -----------------------------
//
// The festival's headline sponsor lives in the flat
// sponsor_name / sponsor_logo_url / sponsor_url columns on the festivals
// row. Anything beyond that one sponsor goes here as separate rows in
// festival_sponsors (sql/062).
//
// All actions are admin-only and revalidate both the admin detail page
// and the public festival landing.

export type FestivalSponsorRow = {
  id: string;
  festival_id: string;
  name: string;
  logo_url: string | null;
  url: string | null;
  sort_order: number;
};

async function revalidateFestivalById(sb: ReturnType<typeof createServiceClient>, festivalId: string) {
  // DRY helper: every sponsor mutation needs to bump the admin page +
  // the public landing. Centralised so we don't drift if the URL shape
  // changes.
  const { data: f } = await sb.from("festivals").select("slug").eq("id", festivalId).maybeSingle();
  revalidatePath(`/admin/festivals/${festivalId}`);
  if (f?.slug) revalidatePath(`/festivals/${f.slug}`);
}

export async function listFestivalSponsors(
  festivalId: string,
): Promise<FestivalSponsorRow[]> {
  if (!(await requireAdmin())) return [];
  const sb = createServiceClient();
  const { data } = await sb
    .from("festival_sponsors")
    .select("id, festival_id, name, logo_url, url, sort_order")
    .eq("festival_id", festivalId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return (data ?? []).map((r: any) => ({
    id: r.id,
    festival_id: r.festival_id,
    name: r.name,
    logo_url: r.logo_url ?? null,
    url: r.url ?? null,
    sort_order: r.sort_order ?? 0,
  }));
}

export async function createFestivalSponsor(input: {
  festivalId: string;
  name: string;
  logoUrl?: string | null;
  url?: string | null;
}): Promise<{ ok: true; row: FestivalSponsorRow } | { error: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };

  const name = (input.name ?? "").trim();
  if (!name) return { error: "Sponsor name is required." };
  if (name.length > 200) return { error: "Sponsor name too long (max 200 chars)." };

  const sb = createServiceClient();

  // Default sort_order: append to the end. One trip to count existing
  // rows so a new sponsor lands below the existing ones rather than
  // jumping to position 0.
  const { count } = await sb
    .from("festival_sponsors")
    .select("id", { count: "exact", head: true })
    .eq("festival_id", input.festivalId);

  const { data: row, error } = await sb
    .from("festival_sponsors")
    .insert({
      festival_id: input.festivalId,
      name,
      logo_url: (input.logoUrl ?? "").trim() || null,
      url: (input.url ?? "").trim() || null,
      sort_order: count ?? 0,
    })
    .select("id, festival_id, name, logo_url, url, sort_order")
    .single();
  if (error || !row) return { error: error?.message ?? "Insert failed." };

  await revalidateFestivalById(sb, input.festivalId);

  return {
    ok: true,
    row: {
      id: row.id,
      festival_id: row.festival_id,
      name: row.name,
      logo_url: row.logo_url ?? null,
      url: row.url ?? null,
      sort_order: row.sort_order ?? 0,
    },
  };
}

export async function updateFestivalSponsor(
  id: string,
  patch: { name?: string; logoUrl?: string | null; url?: string | null },
): Promise<{ ok: true } | { error: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();

  const cleaned: Record<string, any> = {};
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n) return { error: "Sponsor name cannot be blank." };
    if (n.length > 200) return { error: "Sponsor name too long (max 200 chars)." };
    cleaned.name = n;
  }
  if (patch.logoUrl !== undefined) cleaned.logo_url = (patch.logoUrl ?? "").trim() || null;
  if (patch.url !== undefined) cleaned.url = (patch.url ?? "").trim() || null;
  if (Object.keys(cleaned).length === 0) return { ok: true };

  const { data: existing } = await sb
    .from("festival_sponsors")
    .select("festival_id")
    .eq("id", id)
    .maybeSingle();
  const { error } = await sb.from("festival_sponsors").update(cleaned).eq("id", id);
  if (error) return { error: error.message };

  if (existing) await revalidateFestivalById(sb, existing.festival_id);
  return { ok: true };
}

export async function deleteFestivalSponsor(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();

  const { data: existing } = await sb
    .from("festival_sponsors")
    .select("festival_id")
    .eq("id", id)
    .maybeSingle();
  const { error } = await sb.from("festival_sponsors").delete().eq("id", id);
  if (error) return { error: error.message };

  if (existing) await revalidateFestivalById(sb, existing.festival_id);
  return { ok: true };
}

/**
 * Bulk-update sort_order for every sponsor in a festival. The client
 * sends the full ordered list of ids after a drag-to-reorder; we
 * persist each row's new position.
 *
 * One UPDATE per row — fine because festivals rarely have more than
 * 10-20 sponsors. If a festival ever grows past ~100 sponsors we can
 * switch to a single VALUES-list UPDATE.
 */
export async function reorderFestivalSponsors(
  festivalId: string,
  orderedIds: string[],
): Promise<{ ok: true } | { error: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();

  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await sb
      .from("festival_sponsors")
      .update({ sort_order: i })
      .eq("id", orderedIds[i])
      .eq("festival_id", festivalId);
    if (error) return { error: error.message };
  }

  await revalidateFestivalById(sb, festivalId);
  return { ok: true };
}
