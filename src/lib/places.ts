// Shared query for the Places directory — used by the per-town page and the
// cross-location /browse page. Applies the kid filters (category, toddler age,
// accessibility) server-side and returns places with their categories + city.
import type { SupabaseClient } from "@supabase/supabase-js";

const NO_MATCH = "00000000-0000-0000-0000-000000000000";

export type PlaceQuery = {
  cityId?: string | null;        // restrict to one town (town page)
  cityIds?: string[] | null;     // restrict to a set of towns (browse = active towns)
  catSlugs?: string[];           // category filter (venue_genres)
  uncategorised?: boolean;       // only places with NO genre assigned ("Other")
  toddler?: boolean;             // only places suitable from toddler age
  indoorOnly?: boolean;          // rainy-day: indoor or indoor+outdoor places
  outdoorOnly?: boolean;         // planner: outdoor or indoor+outdoor places
  accessKeys?: string[];         // must have ALL these accessibility facets
  freeOnly?: boolean;            // planner: free places only
  maxPrice?: number;             // planner: free, unknown, or price_from <= maxPrice
  suitableForAge?: number;       // planner: place admits a child of this age
};

export async function fetchPlaces(supabase: SupabaseClient, opts: PlaceQuery): Promise<any[]> {
  // Resolve the category filter to a venue-id allow/deny list via venue_genres.
  let venueIdInclude: string[] | null = null; // null = no filter
  let venueIdExclude: string[] = [];

  if (opts.uncategorised) {
    // "Other" — venues with NO genre assigned. Find every venue that HAS a
    // genre so we can exclude them.
    const { data: vg } = await supabase.from("venue_genres").select("venue_id");
    venueIdExclude = Array.from(new Set((vg ?? []).map((r: any) => r.venue_id as string)));
  } else if (opts.catSlugs && opts.catSlugs.length > 0) {
    const { data: gids } = await supabase.from("genres").select("id").in("slug", opts.catSlugs);
    const ids = (gids ?? []).map((g: any) => g.id);
    if (ids.length === 0) {
      venueIdInclude = [];
    } else {
      const { data: vg } = await supabase.from("venue_genres").select("venue_id").in("genre_id", ids);
      venueIdInclude = Array.from(new Set((vg ?? []).map((r: any) => r.venue_id as string)));
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

  if (venueIdInclude !== null) {
    q = q.in("id", venueIdInclude.length ? venueIdInclude : [NO_MATCH]);
  } else if (venueIdExclude.length > 0) {
    q = q.not("id", "in", `(${venueIdExclude.join(",")})`);
  }

  if (opts.toddler) q = q.lte("age_min", 3); // suitable from toddler age (0–3)
  if (opts.indoorOnly) q = q.in("setting", ["indoor", "both"]); // stays dry if it rains
  if (opts.outdoorOnly) q = q.in("setting", ["outdoor", "both"]);
  if (opts.accessKeys && opts.accessKeys.length > 0) q = q.contains("accessibility", opts.accessKeys);
  if (opts.freeOnly) q = q.eq("is_free", true);
  else if (opts.maxPrice != null) q = q.or(`is_free.eq.true,price_from.lte.${opts.maxPrice},price_from.is.null`);
  if (opts.suitableForAge != null) q = q.or(`age_min.is.null,age_min.lte.${opts.suitableForAge}`);

  const { data } = await q;
  return (data ?? []).map((p: any) => ({
    ...p,
    categories: (p.venue_genres ?? []).map((vg: any) => vg.genre).filter(Boolean),
  }));
}
