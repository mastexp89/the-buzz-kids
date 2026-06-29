import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CityMap from "@/components/CityMapClient";
import { dateRangeFor, type DateFilter } from "@/lib/dateRange";

export const revalidate = 60;

type Props = {
  params: Promise<{ city: string }>;
  searchParams: Promise<{ when?: string; all?: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { city } = await params;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return {
    title: `Venue map — ${cap(city)} — The Buzz Kids`,
    description: `Pubs and venues in ${cap(city)} on a map.`,
  };
}

// Filter chips on the map mirror the listings page's "When" filter so users
// can carry their date selection across without re-picking. "Show all venues"
// is a separate toggle for the casual-browse case (where users want to see
// every pub even if it has nothing on).
const DATE_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: "today", label: "Today / Tonight" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "weekend", label: "This weekend" },
  { value: "week", label: "This week" },
  { value: "all", label: "All upcoming" },
];

export default async function CityMapPage({ params, searchParams }: Props) {
  const supabase = await createClient();
  const { city: citySlug } = await params;
  const sp = await searchParams;
  const when = (sp.when as DateFilter) || "today";
  const showAll = sp.all === "1";

  const { data: city } = await supabase.from("cities").select("*").eq("slug", citySlug).single();
  if (!city) notFound();

  const { data: rawVenues } = await supabase
    .from("venues")
    .select("id, name, slug, address, postcode, latitude, longitude")
    .eq("city_id", city.id)
    .eq("approved", true);

  // Count gigs in the active filter window per venue. Used both to filter
  // the venue list (only show pins with ≥1 gig in window) AND to show
  // "3 gigs tonight" in each pin's popup.
  const { from, to } = dateRangeFor(when);
  const venueIds = (rawVenues ?? []).map((v) => v.id);
  const countsInWindow = new Map<string, number>();
  if (venueIds.length > 0) {
    const { data: ev } = await supabase
      .from("events")
      .select("venue_id")
      .in("venue_id", venueIds)
      .gte("start_time", from.toISOString())
      .lte("start_time", to.toISOString())
      .eq("cancelled", false)
      .eq("status", "approved");
    for (const e of ev ?? []) {
      countsInWindow.set(e.venue_id, (countsInWindow.get(e.venue_id) ?? 0) + 1);
    }
  }

  const venuesWithCounts = (rawVenues ?? []).map((v: any) => ({
    ...v,
    upcoming_count: countsInWindow.get(v.id) ?? 0,
  }));

  // Active-filter mode: only show venues with ≥1 gig in the chosen window.
  // "Show all" mode: include every approved venue, regardless.
  const filteredByWhen = showAll
    ? venuesWithCounts
    : venuesWithCounts.filter((v) => v.upcoming_count > 0);

  const withCoords = filteredByWhen.filter((v) => v.latitude !== null && v.longitude !== null);
  const withoutCoords = filteredByWhen.filter((v) => v.latitude === null || v.longitude === null);

  const totalCity = venuesWithCounts.length;
  const totalWithGigs = venuesWithCounts.filter((v) => v.upcoming_count > 0).length;

  // Build hrefs that preserve the OTHER param when toggling one. So clicking
  // a When chip keeps showAll; clicking the toggle keeps when.
  const hrefFor = (override: { when?: string; all?: string }) => {
    const u = new URLSearchParams();
    const nextWhen = override.when ?? when;
    const nextAll = override.all ?? (showAll ? "1" : "");
    if (nextWhen && nextWhen !== "today") u.set("when", nextWhen);
    if (nextAll === "1") u.set("all", "1");
    const qs = u.toString();
    return `/${citySlug}/map${qs ? `?${qs}` : ""}`;
  };

  const activeLabel = DATE_OPTIONS.find((o) => o.value === when)?.label ?? "Today / Tonight";

  return (
    <div className="container-page py-10">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <Link href={`/${city.slug}`} className="text-sm text-buzz-mute hover:text-buzz-accent transition">
            ← Back to {city.name}
          </Link>
          <p className="eyebrow mt-3 mb-1">Venue map</p>
          <h1 className="h-display text-4xl sm:text-5xl">{city.name}</h1>
          <p className="text-buzz-mute text-sm mt-1">
            {showAll ? (
              <>
                {withCoords.length} of {totalCity} venue{totalCity === 1 ? "" : "s"} on the map
                {withoutCoords.length > 0 && (
                  <> · {withoutCoords.length} not pinned (missing postcode)</>
                )}
              </>
            ) : (
              <>
                {withCoords.length} venue{withCoords.length === 1 ? "" : "s"} with gigs in {activeLabel.toLowerCase()}
                {totalCity > totalWithGigs && (
                  <> · {totalCity - totalWithGigs} quiet today</>
                )}
              </>
            )}
          </p>
        </div>
      </div>

      {/* When chips — same selection as the events page */}
      <div className="card p-3 flex flex-wrap gap-2 items-center mb-6">
        <span className="text-xs uppercase tracking-wider text-buzz-mute font-semibold mr-1">
          Showing
        </span>
        {DATE_OPTIONS.map((opt) => {
          const active = !showAll && opt.value === when;
          return (
            <Link
              key={opt.value}
              href={hrefFor({ when: String(opt.value), all: "" })}
              className={active ? "chip-accent" : "chip"}
            >
              {opt.label}
            </Link>
          );
        })}
        <span className="text-xs text-buzz-mute mx-1">/</span>
        <Link
          href={hrefFor({ all: showAll ? "" : "1" })}
          className={showAll ? "chip-accent" : "chip"}
          title="Show every venue, even ones with nothing scheduled"
        >
          🗺️ All venues
        </Link>
      </div>

      {withCoords.length > 0 ? (
        <CityMap venues={withCoords as any} citySlug={city.slug} />
      ) : (
        <div className="card p-10 text-center">
          <div className="text-4xl mb-3">🗺️</div>
          <h2 className="font-display text-2xl uppercase mb-1">
            {showAll ? "No venues on the map yet" : "Quiet right now"}
          </h2>
          <p className="text-buzz-mute max-w-md mx-auto text-sm">
            {showAll
              ? "Once venues are listed with valid UK postcodes they'll appear here automatically."
              : `Nothing on in ${activeLabel.toLowerCase()}. Try a wider date filter, or `}
            {!showAll && (
              <Link href={hrefFor({ all: "1" })} className="text-buzz-accent hover:underline">
                show every venue
              </Link>
            )}
            {!showAll && "."}
          </p>
        </div>
      )}

      {withoutCoords.length > 0 && (
        <div className="mt-8">
          <p className="eyebrow text-[10px] mb-2">Not on the map (missing postcode)</p>
          <div className="text-sm text-buzz-mute">
            {withoutCoords.map((v) => v.name).join(", ")}
          </div>
        </div>
      )}
    </div>
  );
}
