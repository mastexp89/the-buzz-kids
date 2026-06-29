import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thebuzzguide.co.uk";
  const supabase = await createClient();

  const [{ data: cities }, { data: venues }, { data: events }] = await Promise.all([
    supabase.from("cities").select("slug").eq("active", true),
    supabase.from("venues").select("slug, updated_at, city:cities(slug)").eq("approved", true),
    supabase
      .from("events")
      .select("id, updated_at, venue:venues(approved, city:cities(slug))")
      .gte("start_time", new Date().toISOString())
      .eq("cancelled", false)
      .eq("status", "approved")
      .limit(2000),
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

  return [...staticPages, ...cityPages, ...venuePages, ...eventPages];
}
