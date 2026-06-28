import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 1) return NextResponse.json({ venues: [], artists: [], events: [] });

  const supabase = await createClient();

  // Events are only useful while they're still upcoming — past gigs would
  // pollute the dropdown forever. Soonest first so the next "Open Mic" is
  // the one that surfaces.
  const nowIso = new Date().toISOString();

  const [{ data: venues }, { data: artists }, { data: events }] = await Promise.all([
    supabase
      .from("venues")
      .select("id, name, slug, logo_url, cover_photo_url, image_url, city:cities(slug, name)")
      .eq("approved", true)
      .ilike("name", `%${q}%`)
      .order("name")
      .limit(6),
    supabase
      .from("artists")
      .select("id, name, slug, image_url")
      .eq("approved", true)
      .ilike("name", `%${q}%`)
      .order("name")
      .limit(6),
    supabase
      .from("events")
      .select("id, title, start_time, image_url, venue:venues!inner(name, city:cities!inner(slug, name))")
      .eq("status", "approved")
      .gte("start_time", nowIso)
      .ilike("title", `%${q}%`)
      .order("start_time", { ascending: true })
      .limit(6),
  ]);

  return NextResponse.json({
    venues: venues ?? [],
    artists: artists ?? [],
    events: events ?? [],
  });
}
