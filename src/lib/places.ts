// Shared query for the Places directory — used by the per-town page and the
// cross-location /browse page. Applies the kid filters (category, toddler age,
// accessibility) server-side and returns places with their categories + city.
import type { SupabaseClient } from "@supabase/supabase-js";

const NO_MATCH = "00000000-0000-0000-0000-000000000000";

export type PlaceQuery = {
  cityId?: string | null;        // restrict to one town (town page)
  cityIds?: string[] | null;     // restrict to a set of towns (browse = active towns)
  catSlugs?: string[];           // category filter (venue_genres)
  toddler?: boolean;             // only places suitable from toddler age
  indoorOnly?: boolean;          // rainy-day: indoor or indoor+outdoor places
  accessKeys?: string[];         // must have ALL these accessibility facets
};

export async function fetchPlaces(supabase: SupabaseClient, opts: PlaceQuery): Promise<any[]> {
  // Resolve a category filter to a set of venue ids via the venue_genres join.
  let venueIdFilter: string[] | null = null;
  if (opts.catSlugs && opts.catSlugs.length > 0) {
    const { data: gids } = await supabase.from("genres").select("id").in("slug", opts.catSlugs);
    const ids = (gids ?? []).map((g: any) => g.id);
    if (ids.length === 0) {
      venueIdFilter = [];
    } else {
      const { data: vg } = await supabase.from("venue_genres").select("venue_id").in("genre_id", ids);
      venueIdFilter = Array.from(new Set((vg ?? []).map((r: any) => r.venue_id)));
    }
  }

  let q = supabase
    .from("venues")
    .select("*, venue_genres ( genre:genres ( name, slug ) ), city:cities ( name, slug )")
    .eq("approved", true)
    .in("venue_type", ["attraction", "both"])
    .order("name");

  if (opts.cityId) q = q.eq("city_id", opts.cityId);
  if (opts.cityIds) q = q.in("city_id", opts.cityIds.length ? opts.cityIds : [NO_MATCH]);
  if (venueIdFilter !== null) q = q.in("id", venueIdFilter.length ? venueIdFilter : [NO_MATCH]);
  if (opts.toddler) q = q.lte("age_min", 3); // suitable from toddler age (0–3)
  if (opts.indoorOnly) q = q.in("setting", ["indoor", "both"]); // stays dry if it rains
  if (opts.accessKeys && opts.accessKeys.length > 0) q = q.contains("accessibility", opts.accessKeys);

  const { data } = await q;
  return (data ?? []).map((p: any) => ({
    ...p,
    categories: (p.venue_genres ?? []).map((vg: any) => vg.genre).filter(Boolean),
  }));
}
