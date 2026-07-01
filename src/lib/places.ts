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
  openOnDays?: string[];         // only places open on ANY of these day keys ("sat","sun"…)
  dogOnly?: boolean;             // only dog-friendly places
};

// Day-of-week keys matching opening_hours_json's per-day shape.
const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Map the "open" filter value to the day key(s) a place must be open on.
//   "today" / "tomorrow" — resolved against the server's current date
//   "weekend"            — Saturday OR Sunday
//   "YYYY-MM-DD"         — that specific date's weekday
//   anything else / ""   — undefined (no open-day filter)
// Note: computed in the server's timezone (UTC on Vercel). The weekday only
// shifts around local midnight, which is fine for a "what's open" filter.
export function openDayKeysFor(open?: string | null): string[] | undefined {
  if (!open) return undefined;
  if (open === "today") return [DOW[new Date().getDay()]];
  if (open === "tomorrow") {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return [DOW[d.getDay()]];
  }
  if (open === "weekend") return ["sat", "sun"];
  if (/^\d{4}-\d{2}-\d{2}$/.test(open)) {
    const d = new Date(open + "T12:00:00");
    if (!Number.isNaN(d.getTime())) return [DOW[d.getDay()]];
  }
  return undefined;
}

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

  // Select ONLY the columns the place cards + distance sort actually use.
  // Was `select("*")`, which shipped every heavy unused column on all ~1,000+
  // rows — most notably opening_hours_json and photo_refs — bloating the page
  // payload badly. The directory grid never renders those, so we leave them
  // out. (Filters below still run on columns whether or not they're selected.)
  const CARD_COLUMNS =
    "id, name, slug, description, address, " +
    "cover_photo_url, image_url, gallery_image_urls, logo_url, google_photo_url, google_photo_attribution, " +
    "accessibility, age_min, age_max, setting, is_free, price_from, price_note, latitude, longitude, dog_friendly";

  let q = supabase
    .from("venues")
    .select(`${CARD_COLUMNS}, venue_genres ( genre:genres ( name, slug ) ), city:cities ( name, slug )`)
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

  // "Open on this day" — a place passes if it's open on ANY of the requested
  // days OR has no opening hours on file at all (parks, beaches, playgrounds
  // and the ~140 venues we lack hours for shouldn't vanish — only places we
  // KNOW are closed that day get filtered out).
  if (opts.openOnDays && opts.openOnDays.length > 0) {
    const clause = [
      "opening_hours_json.is.null",
      ...opts.openOnDays.map((d) => `opening_hours_json->${d}.not.is.null`),
    ].join(",");
    q = q.or(clause);
  }

  if (opts.dogOnly) q = q.eq("dog_friendly", true);
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
