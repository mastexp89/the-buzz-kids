import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thebuzzkids.co.uk";
  const supabase = await createClient();

  const [{ data: cities }, { data: venues }, { data: events }, { data: venueGenres }, { data: genres }] = await Promise.all([
    supabase.from("cities").select("id, slug").eq("active", true),
    supabase.from("venues").select("id, slug, updated_at, city_id, city:cities(slug)").eq("approved", true),
    supabase
      .from("events")
      .select("id, updated_at, venue:venues(approved, city:cities(slug))")
      .gte("start_time", new Date().toISOString())
      .eq("cancelled", false)
      .eq("status", "approved")
      .limit(2000),
    supabase.from("venue_genres").select("venue_id, genre_id"),
    supabase.from("genres").select("id, slug"),
  ]);

  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: `${baseUrl}/about`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/signup`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/list-your-activity`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/login`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
  ];

  const cityPages: MetadataRoute.Sitemap =
    (cities ?? []).map((c) => ({
      url: `${baseUrl}/${c.slug}`,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 0.9,
    }));

  // "What's on in {city}" — one per active city.
  const whatsOnPages: MetadataRoute.Sitemap =
    (cities ?? []).map((c) => ({
      url: `${baseUrl}/${c.slug}/whats-on`,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 0.8,
    }));

  // "{category} in {city}" — only where a city has >= 3 places in that category
  // (content-gated so we never list a thin/empty page).
  const cityById = new Map((cities ?? []).map((c: any) => [c.id, c.slug]));
  const genreById = new Map((genres ?? []).map((g: any) => [g.id, g.slug]));
  const venueCity = new Map((venues ?? []).map((v: any) => [v.id, v.city_id]));
  const catCounts = new Map<string, number>(); // "citySlug|genreSlug" -> count
  for (const vg of (venueGenres ?? []) as any[]) {
    const citySlug = cityById.get(venueCity.get(vg.venue_id));
    const genreSlug = genreById.get(vg.genre_id);
    if (!citySlug || !genreSlug) continue;
    const key = `${citySlug}|${genreSlug}`;
    catCounts.set(key, (catCounts.get(key) ?? 0) + 1);
  }
  const categoryPages: MetadataRoute.Sitemap = [];
  for (const [key, count] of catCounts) {
    if (count < 3) continue;
    const [citySlug, genreSlug] = key.split("|");
    categoryPages.push({
      url: `${baseUrl}/${citySlug}/${genreSlug}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    });
  }

  const venuePages: MetadataRoute.Sitemap =
    (venues ?? [])
      .filter((v) => (v.city as any)?.slug)
      .map((v) => ({
        url: `${baseUrl}/${(v.city as any).slug}/venues/${v.slug}`,
        lastModified: v.updated_at ? new Date(v.updated_at) : new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.7,
      }));

  const eventPages: MetadataRoute.Sitemap =
    (events ?? [])
      .filter((e) => (e.venue as any)?.approved && (e.venue as any)?.city?.slug)
      .map((e) => ({
        url: `${baseUrl}/${(e.venue as any).city.slug}/events/${e.id}`,
        lastModified: e.updated_at ? new Date(e.updated_at) : new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.6,
      }));

  return [...staticPages, ...cityPages, ...whatsOnPages, ...categoryPages, ...venuePages, ...eventPages];
}
