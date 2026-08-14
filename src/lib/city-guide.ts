// Helpers for the SEO city-guide pages: which categories a city actually has
// content for (so we only ever generate/link pages with real listings — no
// thin "Zip Lines in Nowhere" pages), the city's upcoming events, and a
// dangerouslySetInnerHTML-safe JSON-LD serialiser.

import type { SupabaseClient } from "@supabase/supabase-js";

export type CityCategory = { slug: string; name: string; count: number };

// Genres with at least `min` approved places in this city, most first.
export async function categoriesForCity(
  supabase: SupabaseClient,
  cityId: string,
  min = 1,
): Promise<CityCategory[]> {
  const { data: vg } = await supabase
    .from("venue_genres")
    .select("genre_id, venues!inner(city_id, approved)")
    .eq("venues.city_id", cityId)
    .eq("venues.approved", true);

  const counts = new Map<string, number>();
  for (const r of (vg ?? []) as any[]) {
    counts.set(r.genre_id, (counts.get(r.genre_id) ?? 0) + 1);
  }
  if (counts.size === 0) return [];

  const { data: genres } = await supabase.from("genres").select("id, slug, name");
  const byId = new Map((genres ?? []).map((g: any) => [g.id, g]));
  const out: CityCategory[] = [];
  for (const [gid, count] of counts) {
    if (count < min) continue;
    const g = byId.get(gid);
    if (g) out.push({ slug: g.slug, name: g.name, count });
  }
  return out.sort((a, b) => b.count - a.count);
}

// Upcoming/ongoing approved kids' events in one city, in the shape WhatsOnView
// expects. Mirrors the browse-page events query, filtered to this city.
export async function fetchCityEvents(supabase: SupabaseClient, citySlug: string): Promise<any[]> {
  const nowIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const todayLocal = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const { data } = await supabase
    .from("events")
    .select(
      "id, title, start_time, end_time, end_date, recurrence_pattern, recurrence_until, " +
      "highlighted_until, weekend_boost_until, cancelled, status, image_url, description, " +
      "age_min, age_max, is_free, cover_charge, accessibility, location_name, " +
      "venue:venues(id, name, slug, approved, address, latitude, longitude, cover_photo_url, image_url, gallery_image_urls, logo_url, google_photo_url, city:cities(slug, active, name)), " +
      "city:cities(slug, active, name), " +
      "event_genres(genre:genres(id, name, slug))",
    )
    .eq("status", "approved")
    .eq("cancelled", false)
    .or(
      `start_time.gte.${nowIso},end_time.gte.${nowIso},end_date.gte.${todayLocal},` +
      `recurrence_until.gte.${todayLocal},and(recurrence_pattern.not.is.null,recurrence_until.is.null)`,
    )
    .order("start_time", { ascending: true })
    .limit(1000);

  return (data ?? [])
    .filter((e: any) => {
      if (e.status && e.status !== "approved") return false;
      // Attached to a place → that place must be approved + in this live city.
      if (e.venue) return e.venue.approved && e.venue.city?.active && e.venue.city?.slug === citySlug;
      // Standalone → the event's own city must be this live city.
      return e.city?.active && e.city?.slug === citySlug;
    })
    .map((e: any) => ({ ...e, genres: (e.event_genres ?? []).map((eg: any) => eg.genre).filter(Boolean) }));
}

// JSON-LD for <script dangerouslySetInnerHTML> — escape `<` so a name
// containing "</script>" can't break out of the tag.
export function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}
