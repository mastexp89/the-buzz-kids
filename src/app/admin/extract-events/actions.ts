"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { extractEvents, extractArtistsFromTitle, type ExtractedEvent } from "@/lib/extraction";
import { scrapeVenueWebsite } from "@/lib/scrape-website";
import { scrapeVenueFacebook } from "@/lib/scrape-facebook";
import { uploadPosterFromUrl, isPersistedPosterUrl } from "@/lib/poster-storage";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (prof?.role !== "admin") return null;
  return { supabase, user };
}

export type RunExtractionResult =
  | { ok: true; batchId: string; events: (ExtractedEvent & { id?: string })[] }
  | { error: string };

export async function runExtraction(input: {
  venueId: string;
  source: "manual_upload" | "facebook" | "instagram" | "website" | "email";
  sourceUrl?: string | null;
  textContent?: string | null;
  imageUrls?: string[];
  postedAt?: string | null;
}): Promise<RunExtractionResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised." };
  const { user } = ctx;

  const sb = createServiceClient();

  // Fetch venue
  const { data: venue } = await sb
    .from("venues")
    .select("id, name, slug, owner_id, city_id, city:cities(slug)")
    .eq("id", input.venueId)
    .maybeSingle();
  if (!venue) return { error: "Venue not found." };

  if (!input.textContent && (!input.imageUrls || input.imageUrls.length === 0)) {
    return { error: "Need text content or at least one image." };
  }

  // Pull the available categories so Claude only picks valid slugs
  const { data: genres } = await sb.from("genres").select("id, slug, name").order("name");
  const availableCategories = (genres ?? []).map((g) => ({ slug: g.slug, name: g.name }));
  const genreSlugToId = new Map<string, string>();
  for (const g of genres ?? []) genreSlugToId.set(g.slug, g.id);

  const postedAt = input.postedAt ?? new Date().toISOString();
  // AI-extracted events always auto-approve, regardless of whether the venue
  // has an owner. The admin running the extraction is implicitly approving
  // them; pending review here just creates noise. (Pending review still
  // applies to artist-submitted gigs at owned venues — that's a separate
  // flow in /submit-gig.)
  const autoApprove = true;
  const status = "approved";

  let extraction;
  try {
    extraction = await extractEvents({
      venueName: venue.name,
      postedAt,
      textContent: input.textContent ?? null,
      imageUrls: input.imageUrls ?? [],
      availableCategories,
    });
  } catch (e: any) {
    // Save a failed batch so we can retry
    const { data: failed } = await sb
      .from("extraction_batches")
      .insert({
        venue_id: input.venueId,
        source: input.source,
        source_url: input.sourceUrl ?? null,
        uploaded_by: user.id,
        text_content: input.textContent ?? null,
        image_urls: input.imageUrls ?? [],
        status: "failed",
        error_message: String(e?.message ?? e).slice(0, 500),
      })
      .select("id")
      .single();
    return { error: `Extraction failed: ${e?.message ?? "unknown error"}${failed ? ` (batch ${failed.id})` : ""}` };
  }

  // Persist the batch payload
  const { data: batch, error: bErr } = await sb
    .from("extraction_batches")
    .insert({
      venue_id: input.venueId,
      source: input.source,
      source_url: input.sourceUrl ?? null,
      uploaded_by: user.id,
      text_content: input.textContent ?? null,
      image_urls: input.imageUrls ?? [],
      raw_response: { events: extraction.events, model: extraction.raw?.model, usage: extraction.raw?.usage },
      status: "processed",
    })
    .select("id")
    .single();
  if (bErr) return { error: `Failed to save batch: ${bErr.message}` };

  // Build event rows AND keep each one paired with its AI-picked genre slugs,
  // so we can dedupe and still know which genre links go with which event.
  // The AI also tells us which input image is the poster for each event
  // (poster_image_index) — we resolve that to the actual URL here.
  const inputImages = input.imageUrls ?? [];
  type EventWithMeta = {
    row: Record<string, any>;
    genres: string[];
    artists: string[];
    posterSourceUrl: string | null;
  };
  const allEventsWithGenres: EventWithMeta[] = extraction.events.map((e) => {
    const idx = e.poster_image_index;
    const posterSourceUrl =
      typeof idx === "number" && idx >= 0 && idx < inputImages.length
        ? inputImages[idx]
        : null;
    return {
      row: {
        venue_id: input.venueId,
        title: e.title,
        start_time: e.starts_at,
        end_time: e.ends_at,
        description: e.description,
        status,
        submitted_by: user.id,
        auto_imported_from: input.source,
        auto_import_confidence: e.confidence,
        auto_import_source_url: input.sourceUrl ?? null,
        auto_import_evidence: e.evidence ?? null,
        // Source URL initially — replaced with our permanent storage URL
        // after the post-insert upload step below.
        auto_import_image_url: posterSourceUrl,
        auto_import_post_text: input.textContent ?? null,
        auto_import_batch_id: batch.id,
      },
      genres: e.categories ?? [],
      artists: [],
      posterSourceUrl,
    };
  });

  // Dedupe: drop anything that already exists for this venue (same normalised
  // title OR substring-overlapping title + same start hour) AND any duplicates
  // within this batch. The substring check catches cases like "Sunday's at
  // Sal's" vs "Sunday's at Sal's Paint Sessions" — same event, different
  // captions across two posts.
  const dedupedWithGenres: EventWithMeta[] = [];
  const seenKeys = new Set<string>();
  // Per-hour index of normalised titles, used for substring-overlap matching.
  const titlesByHour = new Map<string, string[]>();

  if (allEventsWithGenres.length > 0) {
    const { data: existing } = await sb
      .from("events")
      .select("title, start_time")
      .eq("venue_id", input.venueId)
      .neq("status", "rejected");
    for (const e of existing ?? []) {
      const hourKey = startHourKey(e.start_time);
      const norm = normaliseTitle(e.title);
      seenKeys.add(`${norm}|${hourKey}`);
      const list = titlesByHour.get(hourKey) ?? [];
      list.push(norm);
      titlesByHour.set(hourKey, list);
    }

    for (const item of allEventsWithGenres) {
      const hourKey = startHourKey(item.row.start_time);
      const norm = normaliseTitle(item.row.title);
      const exactKey = `${norm}|${hourKey}`;
      if (seenKeys.has(exactKey)) continue;

      // Substring-overlap check: same hour, one title contains the other
      // (and neither is trivially short — at least 6 chars to avoid false
      // positives on words like "quiz" or "live").
      const sameHour = titlesByHour.get(hourKey) ?? [];
      const overlap = sameHour.find((t) =>
        norm.length >= 6 && t.length >= 6 && (t.includes(norm) || norm.includes(t))
      );
      if (overlap) continue;

      seenKeys.add(exactKey);
      sameHour.push(norm);
      titlesByHour.set(hourKey, sameHour);
      dedupedWithGenres.push(item);
    }
  }

  let createdEvents: { id: string }[] = [];
  if (dedupedWithGenres.length > 0) {
    const insertRows = dedupedWithGenres.map((d) => d.row);
    const { data, error: eErr } = await sb.from("events").insert(insertRows).select("id");
    if (eErr) return { error: `Failed to create events: ${eErr.message} (batch ${batch.id})` };
    createdEvents = data ?? [];

    // Wire up event_genres using the deduped order (which matches createdEvents order)
    const genreLinks: { event_id: string; genre_id: string }[] = [];
    dedupedWithGenres.forEach((item, i) => {
      const eventId = createdEvents[i]?.id;
      if (!eventId) return;
      for (const slug of item.genres) {
        const gid = genreSlugToId.get(slug);
        if (gid) genreLinks.push({ event_id: eventId, genre_id: gid });
      }
    });
    if (genreLinks.length > 0) {
      await sb.from("event_genres").insert(genreLinks);
    }

    // Resolve artist names → IDs (find existing or auto-create unclaimed) and
    // link via event_artists. Auto-created artists get approved=true so they
    // appear publicly straight away; the artist can later claim the page.
    const allArtistNames = Array.from(
      new Set(
        dedupedWithGenres.flatMap((d) => d.artists),
      ),
    );
    if (allArtistNames.length > 0) {
      const artistNameToId = await resolveOrCreateArtists(sb, allArtistNames, venue.city_id ?? null);

      const artistLinks: { event_id: string; artist_id: string }[] = [];
      dedupedWithGenres.forEach((item, i) => {
        const eventId = createdEvents[i]?.id;
        if (!eventId) return;
        for (const name of item.artists) {
          const aid = artistNameToId.get(normaliseArtistName(name));
          if (aid) artistLinks.push({ event_id: eventId, artist_id: aid });
        }
      });
      if (artistLinks.length > 0) {
        // Use upsert with ignore-duplicates in case the same event-artist pair already exists
        await sb.from("event_artists").upsert(artistLinks, { onConflict: "event_id,artist_id", ignoreDuplicates: true });
      }
    }

    await sb.from("extraction_batches").update({ events_created: createdEvents.length }).eq("id", batch.id);

    // Persist poster images: download each event's source image into our
    // own Supabase Storage bucket so the URL doesn't die when the FB CDN
    // signature expires. Then point both image_url (what the public page
    // shows) and auto_import_image_url at the storage URL.
    for (let i = 0; i < dedupedWithGenres.length; i++) {
      const item = dedupedWithGenres[i];
      const eventId = createdEvents[i]?.id;
      if (!eventId || !item.posterSourceUrl) continue;
      const result = await uploadPosterFromUrl(sb, {
        sourceUrl: item.posterSourceUrl,
        eventId,
      });
      if ("ok" in result) {
        await sb
          .from("events")
          .update({
            image_url: result.publicUrl,
            auto_import_image_url: result.publicUrl,
          })
          .eq("id", eventId);
      } else {
        // Log + leave the source URL on the row for the retro backfill to
        // try again later. Don't fail the whole extraction over a single
        // image.
        console.warn(`[extraction] poster upload failed for event ${eventId}: ${result.error}`);
      }
    }
  }

  // Revalidate the bits of the site that show this venue's events
  if (autoApprove) {
    const citySlug = (venue.city as any)?.slug ?? "dundee";
    revalidatePath(`/${citySlug}/venues/${venue.slug}`);
    revalidatePath(`/${citySlug}`);
  }
  revalidatePath("/admin/queue");

  return {
    ok: true,
    batchId: batch.id,
    events: extraction.events.map((e, i) => ({ ...e, id: createdEvents[i]?.id })),
  };
}

// ---------- Find social URLs via Google Custom Search ----------

const SOCIAL_PLATFORMS: Array<{
  key: "facebook" | "instagram" | "twitter" | "tiktok";
  label: string;
  searchTerm: string;
  domainPattern: RegExp;
  rejectPattern: RegExp;
}> = [
  {
    key: "facebook",
    label: "Facebook",
    searchTerm: "facebook",
    domainPattern: /facebook\.com\//i,
    rejectPattern: /facebook\.com\/(events|search|pages\/category|sharer|share|dialog|reel|watch|story|tr|profile\.php)/i,
  },
  {
    key: "instagram",
    label: "Instagram",
    searchTerm: "instagram",
    domainPattern: /instagram\.com\//i,
    rejectPattern: /instagram\.com\/(p|reel|tv|explore|accounts|sharer)\b/i,
  },
  {
    key: "twitter",
    label: "Twitter/X",
    searchTerm: "twitter",
    domainPattern: /(?:twitter|x)\.com\//i,
    rejectPattern: /\.com\/(intent|share|search|hashtag|i)\b/i,
  },
  {
    key: "tiktok",
    label: "TikTok",
    searchTerm: "tiktok",
    domainPattern: /tiktok\.com\/@/i,
    rejectPattern: /tiktok\.com\/(tag|search|discover|live)/i,
  },
];

export type FindSocialsResult =
  | {
      ok: true;
      venueId: string;
      venueName: string;
      foundUrls: Partial<Record<"facebook" | "instagram" | "twitter" | "tiktok", string>>;
      newCount: number;
    }
  | { error: string; venueId: string; venueName: string };

export async function listVenuesNeedingFacebookUrl(): Promise<ScrapeCandidate[]> {
  const ctx = await requireAdmin();
  if (!ctx) return [];
  const sb = createServiceClient();
  // Surface every venue — server skips platforms that are already filled.
  const { data } = await sb
    .from("venues")
    .select("id, name, website, facebook")
    .order("name");
  return (data ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    facebook: v.facebook,
    website: v.website,
  }));
}

export async function findFacebookUrlForVenue(venueId: string): Promise<FindSocialsResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised.", venueId, venueName: "" };

  const cseKey =
    process.env.GOOGLE_CUSTOM_SEARCH_KEY ??
    process.env.GOOGLE_PLACES_KEY;
  const cseCx = process.env.GOOGLE_CUSTOM_SEARCH_CX;
  if (!cseKey) {
    return {
      error: "Missing GOOGLE_CUSTOM_SEARCH_KEY (or GOOGLE_PLACES_KEY) env var on Vercel.",
      venueId,
      venueName: "",
    };
  }
  if (!cseCx) {
    return {
      error: "Missing GOOGLE_CUSTOM_SEARCH_CX env var on Vercel. See CUSTOM-SEARCH-SETUP.md.",
      venueId,
      venueName: "",
    };
  }

  const sb = createServiceClient();
  const { data: venue } = await sb
    .from("venues")
    .select("id, name, facebook, instagram, twitter, tiktok, city:cities(name)")
    .eq("id", venueId)
    .maybeSingle();
  if (!venue) return { error: "Venue not found.", venueId, venueName: "" };

  const cityName = (venue.city as any)?.name ?? "Dundee";
  const foundUrls: Partial<Record<"facebook" | "instagram" | "twitter" | "tiktok", string>> = {};

  // For each missing platform, run one Custom Search query and pick the first matching URL.
  for (const p of SOCIAL_PLATFORMS) {
    if ((venue as any)[p.key]) continue; // already filled — skip
    const query = `${venue.name} ${cityName} ${p.searchTerm}`;
    const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${cseKey}&cx=${cseCx}&num=5`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text();
        // Hard-fail on auth errors so we stop the whole bulk run instead of burning budget
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          return { error: `Custom Search ${res.status}: ${text.slice(0, 200)}`, venueId, venueName: venue.name };
        }
        // Other errors: skip this platform, continue with the next
        continue;
      }
      const json: any = await res.json();
      const found = pickSocialUrl(json.items ?? [], p.domainPattern, p.rejectPattern);
      if (found) foundUrls[p.key] = found;
    } catch {
      // Network blip on one platform shouldn't kill the rest
    }
  }

  // Persist whatever new URLs we discovered
  const updates: Record<string, string> = {};
  for (const [k, v] of Object.entries(foundUrls)) {
    if (v && !(venue as any)[k]) updates[k] = v;
  }
  if (Object.keys(updates).length > 0) {
    const { error: upErr } = await sb.from("venues").update(updates).eq("id", venueId);
    if (upErr) return { error: `Update failed: ${upErr.message}`, venueId, venueName: venue.name };
  }

  return {
    ok: true,
    venueId,
    venueName: venue.name,
    foundUrls,
    newCount: Object.keys(updates).length,
  };
}

function pickSocialUrl(items: any[], domainPattern: RegExp, rejectPattern: RegExp): string | null {
  for (const item of items) {
    const link: string = item?.link ?? "";
    if (!domainPattern.test(link)) continue;
    if (rejectPattern.test(link)) continue;
    return link.split("?")[0].replace(/\/$/, "");
  }
  return null;
}

// ---------- Find artist socials via Custom Search ----------

const ARTIST_SOCIAL_PLATFORMS: Array<{
  key: "facebook" | "instagram" | "twitter" | "tiktok" | "spotify" | "bandcamp" | "youtube" | "website";
  label: string;
  searchTerm: string;
  domainPattern: RegExp;
  rejectPattern?: RegExp;
}> = [
  { key: "facebook",  label: "Facebook",  searchTerm: "facebook",
    domainPattern: /facebook\.com\//i,
    rejectPattern: /facebook\.com\/(events|search|pages\/category|sharer|share|dialog|reel|watch|story|tr|profile\.php)/i },
  { key: "instagram", label: "Instagram", searchTerm: "instagram",
    domainPattern: /instagram\.com\//i,
    rejectPattern: /instagram\.com\/(p|reel|tv|explore|accounts|sharer)\b/i },
  { key: "spotify",   label: "Spotify",   searchTerm: "spotify artist",
    domainPattern: /open\.spotify\.com\/artist\//i },
  { key: "bandcamp",  label: "Bandcamp",  searchTerm: "bandcamp",
    domainPattern: /\.bandcamp\.com/i,
    rejectPattern: /\/(track|album|merch)\//i },
  { key: "tiktok",    label: "TikTok",    searchTerm: "tiktok",
    domainPattern: /tiktok\.com\/@/i,
    rejectPattern: /tiktok\.com\/(tag|search|discover|live)/i },
  { key: "twitter",   label: "Twitter/X", searchTerm: "twitter",
    domainPattern: /(?:twitter|x)\.com\//i,
    rejectPattern: /\.com\/(intent|share|search|hashtag|i)\b/i },
  { key: "youtube",   label: "YouTube",   searchTerm: "youtube channel",
    domainPattern: /youtube\.com\/(?:c\/|channel\/|@|user\/)/i },
];

export type FindArtistSocialsResult =
  | {
      ok: true;
      artistId: string;
      artistName: string;
      foundUrls: Partial<Record<(typeof ARTIST_SOCIAL_PLATFORMS)[number]["key"], string>>;
      newCount: number;
    }
  | { error: string; artistId: string; artistName: string };

export async function listUnclaimedArtists(): Promise<{ id: string; name: string }[]> {
  const ctx = await requireAdmin();
  if (!ctx) return [];
  const sb = createServiceClient();
  const { data } = await sb
    .from("artists")
    .select("id, name")
    .is("claimed_by", null)
    .eq("approved", true)
    .order("name");
  return (data ?? []) as any;
}

export async function findArtistSocials(artistId: string): Promise<FindArtistSocialsResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised.", artistId, artistName: "" };

  const cseKey =
    process.env.GOOGLE_CUSTOM_SEARCH_KEY ?? process.env.GOOGLE_PLACES_KEY;
  const cseCx = process.env.GOOGLE_CUSTOM_SEARCH_CX;
  if (!cseKey) return { error: "Missing GOOGLE_CUSTOM_SEARCH_KEY env var.", artistId, artistName: "" };
  if (!cseCx) return { error: "Missing GOOGLE_CUSTOM_SEARCH_CX env var.", artistId, artistName: "" };

  const sb = createServiceClient();
  const { data: artist } = await sb
    .from("artists")
    .select("id, name, facebook, instagram, twitter, tiktok, spotify, bandcamp, youtube, website, claimed_by")
    .eq("id", artistId)
    .maybeSingle();
  if (!artist) return { error: "Artist not found.", artistId, artistName: "" };
  // Don't touch claimed artists — owner fills in their own
  if (artist.claimed_by) {
    return { ok: true, artistId, artistName: artist.name, foundUrls: {}, newCount: 0 };
  }

  const foundUrls: Partial<Record<(typeof ARTIST_SOCIAL_PLATFORMS)[number]["key"], string>> = {};

  for (const p of ARTIST_SOCIAL_PLATFORMS) {
    if ((artist as any)[p.key]) continue;
    const query = `${artist.name} ${p.searchTerm}`;
    const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${cseKey}&cx=${cseCx}&num=5`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          const text = await res.text();
          return { error: `Custom Search ${res.status}: ${text.slice(0, 200)}`, artistId, artistName: artist.name };
        }
        continue;
      }
      const json: any = await res.json();
      const found = pickSocialUrl(json.items ?? [], p.domainPattern, p.rejectPattern ?? /__never__/);
      if (found) foundUrls[p.key] = found;
    } catch {
      // Skip this platform on a single fetch error
    }
  }

  const updates: Record<string, string> = {};
  for (const [k, v] of Object.entries(foundUrls)) {
    if (v && !(artist as any)[k]) updates[k] = v;
  }
  if (Object.keys(updates).length > 0) {
    const { error: upErr } = await sb.from("artists").update(updates).eq("id", artistId);
    if (upErr) return { error: `Update failed: ${upErr.message}`, artistId, artistName: artist.name };
  }

  return {
    ok: true,
    artistId,
    artistName: artist.name,
    foundUrls,
    newCount: Object.keys(updates).length,
  };
}

// ---------- Backfill artists for existing extracted events ----------

export type BackfillCandidateEvent = {
  id: string;
  title: string;
  description: string | null;
  venue_id: string;
  venue_name: string;
  city_id: string | null;
};

export async function listEventsNeedingArtistBackfill(limit = 1000): Promise<BackfillCandidateEvent[]> {
  const ctx = await requireAdmin();
  if (!ctx) return [];
  const sb = createServiceClient();

  // Pull AI-imported events with no event_artists rows yet.
  // PostgREST can't do "left join is null" in one query cleanly, so:
  // 1) fetch event ids that DO have artists,
  // 2) fetch all AI events,
  // 3) subtract.
  const { data: linkedRows } = await sb
    .from("event_artists")
    .select("event_id");
  const linked = new Set((linkedRows ?? []).map((r: any) => r.event_id));

  const { data: events } = await sb
    .from("events")
    .select("id, title, description, venue_id, venue:venues(id, name, city_id)")
    .not("auto_imported_from", "is", null)
    .neq("status", "rejected")
    .order("created_at", { ascending: false })
    .limit(limit);

  return (events ?? [])
    .filter((e: any) => !linked.has(e.id))
    .map((e: any) => ({
      id: e.id,
      title: e.title,
      description: e.description ?? null,
      venue_id: e.venue_id,
      venue_name: e.venue?.name ?? "Unknown venue",
      city_id: e.venue?.city_id ?? null,
    }));
}

export type BackfillOneResult =
  | { ok: true; eventId: string; artistsLinked: number; artistNames: string[] }
  | { error: string; eventId: string };

export async function backfillArtistsForEvent(eventId: string): Promise<BackfillOneResult> {
  // Wrap the whole body in a try/catch so any throw (rate limit, network blip,
  // DB transient error) becomes a returned `error`, never an unhandled crash
  // that makes Next.js return "An unexpected response was received".
  try {
    const ctx = await requireAdmin();
    if (!ctx) return { error: "Not authorised.", eventId };

    const sb = createServiceClient();
    const { data: event, error: eErr } = await sb
      .from("events")
      .select("id, title, description, venue_id, venue:venues(id, name, city_id)")
      .eq("id", eventId)
      .maybeSingle();
    if (eErr) return { error: `DB lookup: ${eErr.message}`, eventId };
    if (!event) return { error: "Event not found.", eventId };

    let names: string[] = [];
    try {
      names = await extractArtistsFromTitle({
        venueName: (event.venue as any)?.name ?? "",
        title: event.title,
        description: event.description ?? null,
      });
    } catch (e: any) {
      // Anthropic rate-limit / network / 500 — return as a soft fail so the bulk
      // run continues with the next event.
      return { error: e?.message ?? "Extraction failed", eventId };
    }
    if (names.length === 0) {
      return { ok: true, eventId, artistsLinked: 0, artistNames: [] };
    }

    const cityId = (event.venue as any)?.city_id ?? null;
    let nameToId: Map<string, string>;
    try {
      nameToId = await resolveOrCreateArtists(sb, names, cityId);
    } catch (e: any) {
      return { error: `Resolve artists: ${e?.message ?? e}`, eventId };
    }

    const links: { event_id: string; artist_id: string }[] = [];
    for (const name of names) {
      const aid = nameToId.get(normaliseArtistName(name));
      if (aid) links.push({ event_id: eventId, artist_id: aid });
    }
    if (links.length > 0) {
      const { error: linkErr } = await sb
        .from("event_artists")
        .upsert(links, { onConflict: "event_id,artist_id", ignoreDuplicates: true });
      if (linkErr) return { error: `Link failed: ${linkErr.message}`, eventId };
    }

    return { ok: true, eventId, artistsLinked: links.length, artistNames: names };
  } catch (e: any) {
    return { error: e?.message ?? "Unknown error", eventId };
  }
}

// ---------- Retro: persist poster images for existing events ----------

export type PosterBackfillCandidate = {
  id: string;
  title: string;
  source: string | null;
  imageUrl: string | null;
};

export async function listPosterBackfillCandidates(limit = 1000): Promise<PosterBackfillCandidate[]> {
  const ctx = await requireAdmin();
  if (!ctx) return [];
  const sb = createServiceClient();

  // Events where auto_import_image_url is set but NOT yet a persisted storage URL.
  const { data } = await sb
    .from("events")
    .select("id, title, auto_imported_from, auto_import_image_url")
    .not("auto_import_image_url", "is", null)
    .neq("status", "rejected")
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? [])
    .filter((e: any) => !isPersistedPosterUrl(e.auto_import_image_url))
    .map((e: any) => ({
      id: e.id,
      title: e.title,
      source: e.auto_imported_from ?? null,
      imageUrl: e.auto_import_image_url,
    }));
}

export type PosterBackfillResult =
  | { ok: true; eventId: string; publicUrl: string }
  | { error: string; eventId: string };

export async function backfillPosterForEvent(eventId: string): Promise<PosterBackfillResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised.", eventId };

  const sb = createServiceClient();
  const { data: event } = await sb
    .from("events")
    .select("id, auto_import_image_url, image_url")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return { error: "Event not found.", eventId };
  if (!event.auto_import_image_url) return { error: "No source image on file.", eventId };
  if (isPersistedPosterUrl(event.auto_import_image_url)) {
    return { ok: true, eventId, publicUrl: event.auto_import_image_url };
  }

  const result = await uploadPosterFromUrl(sb, {
    sourceUrl: event.auto_import_image_url,
    eventId,
  });
  if ("error" in result) return { error: result.error, eventId };

  // Only overwrite image_url if the venue/owner hasn't manually set their own.
  // We compare against the previous source URL — if image_url currently equals
  // the source URL OR is null, fill it. Otherwise leave the manual value alone.
  const updates: Record<string, string> = {
    auto_import_image_url: result.publicUrl,
  };
  if (!event.image_url || event.image_url === event.auto_import_image_url) {
    updates.image_url = result.publicUrl;
  }
  await sb.from("events").update(updates).eq("id", eventId);

  return { ok: true, eventId, publicUrl: result.publicUrl };
}

// ---------- Retro: re-fetch source page and pull a better poster image ----------
//
// Why this exists: lots of older imports stored the wrong image (a site logo
// or page header) because our HTML parser used to take the first <img> tag.
// We now prioritise og:image / twitter:image / WordPress featured image, but
// only on NEW imports. This action re-runs the new logic against an event's
// stored source URL so old events get the right image too.
//
// Excludes Facebook-sourced events — their source URL is a FB post page,
// which we can't fetch directly (auth wall). Their posters already came
// through Apify, so the auto_import_image_url is the best we have.

export type RediscoverCandidate = {
  id: string;
  title: string;
  source: string | null;
  sourceUrl: string;
  currentImage: string | null;
};

export async function listRediscoverCandidates(limit = 500): Promise<RediscoverCandidate[]> {
  const ctx = await requireAdmin();
  if (!ctx) return [];
  const sb = createServiceClient();

  const { data } = await sb
    .from("events")
    .select("id, title, auto_imported_from, auto_import_source_url, image_url")
    .not("auto_import_source_url", "is", null)
    .neq("status", "rejected")
    .neq("auto_imported_from", "facebook") // FB pages aren't fetchable
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? [])
    .filter((e: any) => {
      const url = e.auto_import_source_url ?? "";
      // Skip anything that smells like Facebook even if auto_imported_from wasn't tagged
      if (/facebook\.com|fb\.me|fb\.watch/i.test(url)) return false;
      return /^https?:\/\//i.test(url);
    })
    .map((e: any) => ({
      id: e.id,
      title: e.title,
      source: e.auto_imported_from ?? null,
      sourceUrl: e.auto_import_source_url,
      currentImage: e.image_url,
    }));
}

export type RediscoverResult =
  | { ok: true; eventId: string; publicUrl: string; updated: boolean }
  | { error: string; eventId: string };

export async function rediscoverPosterFromSource(eventId: string): Promise<RediscoverResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised.", eventId };

  // Lazy-load to avoid pulling these at module init
  const { fetchRawHtml } = await import("@/lib/scrape-website");
  const sb = createServiceClient();

  const { data: event } = await sb
    .from("events")
    .select("id, auto_import_source_url, image_url, auto_import_image_url")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return { error: "Event not found.", eventId };
  if (!event.auto_import_source_url) return { error: "No source URL on file.", eventId };

  const raw = await fetchRawHtml(event.auto_import_source_url);
  if ("error" in raw) return { error: `Fetch failed: ${raw.error}`, eventId };

  // Parse using the same extractor the importer uses, then take the first
  // (= highest-priority: og:image / twitter:image / featured image).
  const html = raw.html;
  let posterUrl: string | null = null;
  // og:image first — most reliable
  const og = html.match(
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
  ) ?? html.match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
  );
  if (og?.[1]) {
    try { posterUrl = new URL(og[1], raw.finalUrl).toString(); } catch { /* ignore */ }
  }
  // twitter:image fallback
  if (!posterUrl) {
    const tw = html.match(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i);
    if (tw?.[1]) {
      try { posterUrl = new URL(tw[1], raw.finalUrl).toString(); } catch { /* ignore */ }
    }
  }
  // WordPress featured image
  if (!posterUrl) {
    const wp = html.match(/<img[^>]+class=["'][^"']*wp-post-image[^"']*["'][^>]+src=["']([^"']+)["']/i);
    if (wp?.[1]) {
      try { posterUrl = new URL(wp[1], raw.finalUrl).toString(); } catch { /* ignore */ }
    }
  }
  if (!posterUrl) return { error: "Couldn't find a poster image on the source page.", eventId };

  // If we already have this exact URL persisted, just confirm and bail.
  if (event.auto_import_image_url === posterUrl && event.image_url && isPersistedPosterUrl(event.image_url)) {
    return { ok: true, eventId, publicUrl: event.image_url, updated: false };
  }

  const stored = await uploadPosterFromUrl(sb, { sourceUrl: posterUrl, eventId });
  if ("error" in stored) return { error: stored.error, eventId };

  // Always update — the whole point of this action is to overwrite the wrong image.
  await sb.from("events")
    .update({ image_url: stored.publicUrl, auto_import_image_url: stored.publicUrl })
    .eq("id", eventId);

  return { ok: true, eventId, publicUrl: stored.publicUrl, updated: true };
}

// ---------- Helpers ----------

// Normalise (title, start_time) → a stable key used to detect duplicate events.
// Title: lowercased, whitespace + punctuation stripped.
// Start time: rounded to the start of the hour so 8:30pm vs 8:00pm collide for
// the same daily event.
function eventDedupeKey(title: string, startTime: string): string {
  return `${normaliseTitle(title)}|${startHourKey(startTime)}`;
}

function normaliseTitle(title: string): string {
  return (title || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function startHourKey(startTime: string): string {
  const t = new Date(startTime);
  return Number.isNaN(t.getTime())
    ? startTime
    : `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}T${pad2(t.getUTCHours())}`;
}
function pad2(n: number) { return String(n).padStart(2, "0"); }

// Normalise an artist name for fuzzy matching. Lowercased, punctuation stripped,
// "the" prefix dropped (so "The Vegan Leather" matches "Vegan Leather").
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

/**
 * For each artist name, find an existing artist by (case-insensitive normalised name)
 * or create one with approved=true and claimed_by=null (so it's claimable later).
 * Returns a map of normalised name → artist id.
 */
async function resolveOrCreateArtists(
  sb: ReturnType<typeof createServiceClient>,
  names: string[],
  cityId: string | null,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const cleaned = names
    .map((n) => n.trim())
    .filter((n) => n.length > 0 && n.length <= 80);
  if (cleaned.length === 0) return out;

  const normalised = Array.from(new Set(cleaned.map(normaliseArtistName))).filter(Boolean);
  if (normalised.length === 0) return out;

  // 1. Look up existing artists by name (case-insensitive) — only for the names
  // we care about, not the whole table. PostgREST `or=` with a list of ilike
  // conditions, capped to keep the URL short.
  const ilikeBatch = cleaned.slice(0, 30); // safety cap
  const orFilter = ilikeBatch
    .map((n) => `name.ilike.${escapeIlike(n)}`)
    .join(",");
  if (orFilter) {
    const { data: existing } = await sb
      .from("artists")
      .select("id, name")
      .or(orFilter);
    for (const a of existing ?? []) {
      const key = normaliseArtistName(a.name);
      if (normalised.includes(key) && !out.has(key)) {
        out.set(key, a.id);
      }
    }
  }

  // 2. Create any artists we didn't find
  const toCreate = cleaned.filter((n) => !out.has(normaliseArtistName(n)));
  for (const name of toCreate) {
    const key = normaliseArtistName(name);
    if (out.has(key)) continue;
    const baseSlug = slugifyArtist(name);
    if (!baseSlug) continue;

    let slug = baseSlug;
    for (let i = 0; i < 5; i++) {
      const { data: created, error } = await sb
        .from("artists")
        .insert({
          name,
          slug,
          city_id: cityId,
          approved: true,
        })
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

// Escape a string for use inside a PostgREST `name.ilike.<value>` filter.
// Commas and parentheses break the filter syntax.
function escapeIlike(s: string): string {
  return s
    .replace(/[\\,()]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// ---------- Bulk: list scrape candidates ----------

export type ScrapeCandidate = {
  id: string;
  name: string;
  facebook: string | null;
  website: string | null;
};

export async function listWebsiteScrapeCandidates(): Promise<ScrapeCandidate[]> {
  const ctx = await requireAdmin();
  if (!ctx) return [];
  const sb = createServiceClient();
  const { data } = await sb
    .from("venues")
    .select("id, name, website, facebook")
    .not("website", "is", null)
    .order("name");
  return (data ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    facebook: v.facebook,
    website: v.website,
  }));
}

export async function listFacebookScrapeCandidates(): Promise<ScrapeCandidate[]> {
  const ctx = await requireAdmin();
  if (!ctx) return [];
  const sb = createServiceClient();
  const { data } = await sb
    .from("venues")
    .select("id, name, website, facebook")
    .not("facebook", "is", null)
    .order("name");
  return (data ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    facebook: v.facebook,
    website: v.website,
  }));
}

// ---------- Per-venue scrape + extract ----------

export type ScrapeOneResult =
  | { ok: true; venueId: string; venueName: string; eventsCreated: number; pagesScraped?: number; postsScraped?: number; errors?: string[] }
  | { error: string; venueId: string; venueName: string };

export type SocialsOnlyResult =
  | { ok: true; venueId: string; venueName: string; socialsFound: number; pagesScraped: number }
  | { error: string; venueId: string; venueName: string };

/**
 * Fast & free: fetch the venue's website + common subpages, extract only social
 * URLs (FB, Insta, Twitter, etc.). Skips the AI event extraction. Saves any
 * found URLs to columns currently null.
 */
export async function extractSocialsFromWebsite(venueId: string): Promise<SocialsOnlyResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised.", venueId, venueName: "" };

  const sb = createServiceClient();
  const { data: venue } = await sb
    .from("venues")
    .select("id, name, website, facebook, instagram, twitter, tiktok, youtube, spotify")
    .eq("id", venueId)
    .maybeSingle();
  if (!venue) return { error: "Venue not found.", venueId, venueName: "" };
  if (!venue.website) return { error: "No website on file.", venueId, venueName: venue.name };

  const scrape = await scrapeVenueWebsite(venue.website);
  if (Object.keys(scrape.socials).length === 0) {
    return {
      ok: true,
      venueId,
      venueName: venue.name,
      socialsFound: 0,
      pagesScraped: scrape.pages.length,
    };
  }

  // Only fill fields that are currently null
  const updates: Record<string, string> = {};
  for (const k of ["facebook", "instagram", "twitter", "tiktok", "youtube", "spotify"] as const) {
    const found = scrape.socials[k];
    if (found && !(venue as any)[k]) updates[k] = found;
  }
  if (Object.keys(updates).length > 0) {
    const { error: upErr } = await sb.from("venues").update(updates).eq("id", venueId);
    if (upErr) {
      return { error: `Update failed: ${upErr.message}`, venueId, venueName: venue.name };
    }
  }

  return {
    ok: true,
    venueId,
    venueName: venue.name,
    socialsFound: Object.keys(updates).length,
    pagesScraped: scrape.pages.length,
  };
}

/**
 * Scrape a single venue's website and run AI extraction across the pages.
 * Designed to be called once per venue from the client so we don't hit Vercel timeouts.
 */
export async function extractFromWebsite(venueId: string): Promise<ScrapeOneResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised.", venueId, venueName: "" };

  const sb = createServiceClient();
  const { data: venue } = await sb
    .from("venues")
    .select("id, name, website")
    .eq("id", venueId)
    .maybeSingle();
  if (!venue) return { error: "Venue not found.", venueId, venueName: "" };
  if (!venue.website) return { error: "No website on file.", venueId, venueName: venue.name };

  const scrape = await scrapeVenueWebsite(venue.website);

  // Free FB/Insta/etc. discovery — save any social URLs we found in the HTML
  // to the venue, but only fill columns that are currently null (don't clobber
  // anything an admin or owner has manually set).
  if (Object.keys(scrape.socials).length > 0) {
    const { data: current } = await sb
      .from("venues")
      .select("facebook, instagram, twitter, tiktok, youtube, spotify")
      .eq("id", venueId)
      .maybeSingle();
    const updates: Record<string, string> = {};
    for (const k of ["facebook", "instagram", "twitter", "tiktok", "youtube", "spotify"] as const) {
      const found = scrape.socials[k];
      if (found && !(current as any)?.[k]) updates[k] = found;
    }
    if (Object.keys(updates).length > 0) {
      await sb.from("venues").update(updates).eq("id", venueId);
    }
  }

  if (scrape.pages.length === 0) {
    return {
      error: `No content scraped${scrape.errors.length ? `: ${scrape.errors[0]}` : ""}`,
      venueId,
      venueName: venue.name,
    };
  }

  // Concatenate all pages' text and dedupe images. Keep it under ~30k chars to
  // be safe with the model's input context.
  const combinedText = scrape.pages
    .map((p) => `--- ${p.title || p.url} ---\n${p.text}`)
    .join("\n\n")
    .slice(0, 30_000);
  const allImages = Array.from(
    new Set(scrape.pages.flatMap((p) => p.imageUrls)),
  ).slice(0, 6);

  // Pipe through the existing single-call extractor
  const r = await runExtraction({
    venueId,
    source: "website",
    sourceUrl: venue.website,
    textContent: combinedText,
    imageUrls: allImages,
    postedAt: new Date().toISOString(),
  });
  if ("error" in r) {
    return { error: r.error, venueId, venueName: venue.name };
  }
  return {
    ok: true,
    venueId,
    venueName: venue.name,
    eventsCreated: r.events.length,
    pagesScraped: scrape.pages.length,
    errors: scrape.errors,
  };
}

/**
 * Scrape a single venue's Facebook page (via Apify) and run AI extraction
 * once per recent post.
 */
export async function extractFromFacebook(opts: {
  venueId: string;
  apifyToken: string;
  actorId?: string;
  maxPosts?: number;
}): Promise<ScrapeOneResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised.", venueId: opts.venueId, venueName: "" };

  if (!opts.apifyToken) {
    return { error: "Apify token required.", venueId: opts.venueId, venueName: "" };
  }

  const sb = createServiceClient();
  const { data: venue } = await sb
    .from("venues")
    .select("id, name, facebook")
    .eq("id", opts.venueId)
    .maybeSingle();
  if (!venue) return { error: "Venue not found.", venueId: opts.venueId, venueName: "" };
  if (!venue.facebook) return { error: "No FB URL on file.", venueId: opts.venueId, venueName: venue.name };

  let scrape;
  try {
    scrape = await scrapeVenueFacebook({
      facebookUrl: venue.facebook,
      apifyToken: opts.apifyToken,      actorId: opts.actorId,
      maxPosts: opts.maxPosts ?? 8,
    });
  } catch (e: any) {
    return { error: `FB scrape failed: ${e?.message ?? "unknown"}`, venueId: opts.venueId, venueName: venue.name };
  }

  if (scrape.posts.length === 0) {
    return { ok: true, venueId: opts.venueId, venueName: venue.name, eventsCreated: 0, postsScraped: 0 };
  }

  let totalEvents = 0;
  const postErrors: string[] = [];
  for (const post of scrape.posts) {
    const r = await runExtraction({
      venueId: opts.venueId,
      source: "facebook",
      sourceUrl: post.url || venue.facebook,
      textContent: post.text || null,
      imageUrls: post.imageUrls,
      postedAt: post.postedAt,
    });
    if ("error" in r) {
      postErrors.push(r.error);
    } else {
      totalEvents += r.events.length;
    }
  }

  return {
    ok: true,
    venueId: opts.venueId,
    venueName: venue.name,
    eventsCreated: totalEvents,
    postsScraped: scrape.posts.length,
    errors: postErrors,
  };
}
