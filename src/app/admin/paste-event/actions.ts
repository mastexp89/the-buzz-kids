"use server";

// Paste-a-post → draft event tool. An admin or editor pastes a Facebook
// (or any) post; Claude extracts the kids' event(s); the user reviews and
// publishes. Available to admins + editors (restricted contributors).

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { extractEvents, type ExtractedEvent } from "@/lib/extraction";
import { canContribute } from "@/lib/roles";
import { revalidatePath } from "next/cache";

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!canContribute(prof?.role)) return null;
  return { userId: user.id };
}

// DST-exact Europe/London local "YYYY-MM-DDTHH:mm" → UTC ISO. Mirrors the
// admin add-event form so a pasted "1pm" stays 1pm UK time.
function toIso(local: string | null): string | null {
  if (!local) return null;
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m.map(Number) as unknown as number[];
  let utcMs = Date.UTC(y, mo - 1, d, hh, mm);
  const wantUtc = utcMs;
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(utcMs));
    const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    const londonAsUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") === 24 ? 0 : g("hour"), g("minute"));
    const diff = wantUtc - londonAsUtc;
    if (diff === 0) break;
    utcMs += diff;
  }
  return new Date(utcMs).toISOString();
}

// An extracted event, flattened to what the review UI edits + publishes.
export type PasteDraft = {
  title: string;
  starts_at: string;        // ISO (Europe/London instant) from the extractor
  ends_at: string | null;
  end_date: string | null;  // YYYY-MM-DD multi-day run
  description: string;
  categories: string[];     // genre slugs
  age_min: number | null;
  age_max: number | null;
  cover_charge: string | null;
  is_free: boolean;
  price_from: number | null;
  booking_required: boolean;
  ticket_url: string | null;
  setting: "indoor" | "outdoor" | "both" | null;
  accessibility: string[];
  confidence: number;
  venue_hint: string | null;
};

export type ExtractPasteResult = { ok: true; drafts: PasteDraft[] } | { error: string };

export async function extractPastedEvent(input: {
  text: string;
  imageUrl?: string;
  cityId?: string | null;
}): Promise<ExtractPasteResult> {
  if (!(await requireStaff())) return { error: "Staff only." };
  const text = (input.text ?? "").trim();
  const imageUrl = (input.imageUrl ?? "").trim();
  if (!text && !imageUrl) return { error: "Paste the post text (or add an image URL)." };

  const sb = createServiceClient();
  const { data: genres } = await sb.from("genres").select("slug, name").order("name");

  // Anchor relative dates ("this Saturday") and bias to the chosen area.
  let locationFilter: { city: string; nearbyAreas?: string[] } | undefined;
  if (input.cityId) {
    const { data: c } = await sb.from("cities").select("name, nearby_areas").eq("id", input.cityId).maybeSingle();
    if (c) locationFilter = { city: c.name, nearbyAreas: (c.nearby_areas as string[] | null) ?? [] };
  }

  let extraction;
  try {
    extraction = await extractEvents({
      venueName: "(detect the place/organiser from the post)",
      postedAt: new Date().toISOString(),
      textContent: text || null,
      imageUrls: imageUrl ? [imageUrl] : [],
      availableCategories: (genres ?? []).map((g) => ({ slug: g.slug, name: g.name })),
      locationFilter,
    });
  } catch (e: any) {
    return { error: `Extraction failed: ${e?.message ?? "unknown error"}` };
  }

  const drafts: PasteDraft[] = (extraction.events ?? []).map((e: ExtractedEvent) => ({
    title: e.title,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    end_date: e.end_date,
    description: e.description ?? "",
    categories: e.categories ?? [],
    age_min: e.age_min,
    age_max: e.age_max,
    cover_charge: e.cover_charge,
    is_free: e.is_free,
    price_from: e.price_from,
    booking_required: e.booking_required,
    ticket_url: e.ticket_url,
    setting: e.setting,
    accessibility: e.accessibility ?? [],
    confidence: e.confidence,
    venue_hint: e.venue_hint,
  }));

  if (drafts.length === 0) return { error: "No event found in that post. Try pasting more of it, or add the poster image URL." };
  return { ok: true, drafts };
}

// Venue typeahead for attaching a draft to an existing place (optional).
export async function searchVenuesForPaste(query: string): Promise<{ id: string; name: string; city: string | null }[]> {
  if (!(await requireStaff())) return [];
  const q = (query ?? "").trim();
  if (q.length < 2) return [];
  const sb = createServiceClient();
  const { data } = await sb
    .from("venues").select("id, name, city:cities(name)")
    .ilike("name", `%${q.replace(/[%_]/g, "")}%`).order("name").limit(10);
  return (data ?? []).map((v: any) => ({ id: v.id, name: v.name, city: v.city?.name ?? null }));
}

export type PublishPasteInput = {
  cityId: string;
  venueId: string | null;       // attach to a place, or null for standalone
  locationName: string | null;  // standalone location label
  imageUrl: string | null;
  sourceUrl: string | null;
  drafts: Array<{
    title: string;
    startLocal: string;         // "YYYY-MM-DDTHH:mm" UK local
    endLocal: string | null;
    end_date: string | null;
    description: string;
    categories: string[];
    age_min: number | null;
    age_max: number | null;
    cover_charge: string | null;
    is_free: boolean;
    price_from: number | null;
    booking_required: boolean;
    setting: "indoor" | "outdoor" | "both" | null;
    accessibility: string[];
  }>;
};

export type PublishPasteResult = { ok: true; published: number } | { error: string };

export async function publishPastedEvents(input: PublishPasteInput): Promise<PublishPasteResult> {
  const ctx = await requireStaff();
  if (!ctx) return { error: "Staff only." };
  if (!input.cityId) return { error: "Pick an area." };
  if (!input.venueId && !(input.locationName ?? "").trim()) return { error: "Attach a place, or give a location name." };

  const rows = input.drafts
    .filter((d) => d.title?.trim() && d.startLocal)
    .map((d) => {
      const start = toIso(d.startLocal);
      if (!start) return null;
      return {
        venue_id: input.venueId || null,
        city_id: input.cityId,
        location_name: input.venueId ? null : (input.locationName ?? "").trim() || null,
        title: d.title.trim().slice(0, 200),
        start_time: start,
        end_time: toIso(d.endLocal),
        end_date: d.end_date || null,
        description: (d.description ?? "").trim().slice(0, 2000) || null,
        cover_charge: d.is_free ? null : (d.cover_charge?.trim().slice(0, 100) || null),
        is_free: !!d.is_free,
        price_from: d.is_free ? 0 : (d.price_from ?? null),
        booking_required: !!d.booking_required,
        setting: d.setting,
        accessibility: d.accessibility?.length ? d.accessibility : null,
        age_min: d.age_min,
        age_max: d.age_max,
        ticket_url: (input.sourceUrl ?? "").trim() || null,
        image_url: (input.imageUrl ?? "").trim() || null,
        status: "approved",
        submitted_by: ctx.userId,
        auto_imported_from: "facebook_paste",
        _categories: d.categories,
      };
    })
    .filter(Boolean) as Array<Record<string, any>>;

  if (rows.length === 0) return { error: "Every draft was missing a title or start time." };

  const sb = createServiceClient();
  const { data: genreRows } = await sb.from("genres").select("id, slug");
  const gid = new Map((genreRows ?? []).map((g) => [g.slug, g.id]));

  let published = 0;
  for (const row of rows) {
    const cats: string[] = row._categories ?? [];
    delete row._categories;
    const { data: ins, error } = await sb.from("events").insert(row).select("id").single();
    if (error || !ins) continue;
    published++;
    const links = cats.map((s) => gid.get(s)).filter(Boolean).map((id) => ({ event_id: ins.id, genre_id: id }));
    if (links.length) await sb.from("event_genres").insert(links);
  }
  if (published === 0) return { error: "Nothing published — check the dates and try again." };

  revalidatePath("/browse");
  revalidatePath("/admin/events-manage");
  return { ok: true, published };
}
