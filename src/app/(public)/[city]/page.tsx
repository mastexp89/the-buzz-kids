import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import EventCard from "@/components/EventCard";
import EventsList from "@/components/EventsList";
import EventFilters from "@/components/EventFilters";
import { AccessibilityLegend } from "@/components/AccessibilityBadges";
import CollapsibleVenueGrid from "@/components/CollapsibleVenueGrid";
import CitySwitcher from "@/components/CitySwitcher";
import SponsorBanner from "@/components/SponsorBanner";
import { dateRangeFor, type DateFilter } from "@/lib/dateRange";
import { formatDateRangeLabel, effectiveEndTime } from "@/lib/utils";
import { trackPageView } from "@/lib/track";
import type { EventWithVenue } from "@/lib/types";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ city: string }>;
  searchParams: Promise<{ when?: string; genre?: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { city } = await params;
  return {
    title: `What's on in ${cap(city)} — The Buzz Guide`,
    description: `Pubs, gigs and nights out in ${cap(city)}. Find what's on tonight, this weekend and beyond — filter by genre, date or venue.`,
    alternates: { canonical: `/${city}` },
  };
}

export default async function CityPage({ params, searchParams }: Props) {
  const supabase = await createClient();
  const { city: citySlug } = await params;
  const sp = await searchParams;

  const [{ data: city }, { data: cities }, { data: genres }] = await Promise.all([
    supabase.from("cities").select("*").eq("slug", citySlug).single(),
    supabase.from("cities").select("*").order("name"),
    supabase.from("genres").select("*").order("name"),
  ]);

  // Inactive cities 404 entirely — the admin's hidden them deliberately
  // and we don't want the URL to leak that the region is being prepped.
  if (!city || !city.active) notFound();

  // Track city-listing views — significant share of traffic lands here
  // ("What's on in Dundee tonight?") before drilling into a venue or
  // event. Source field lets analytics distinguish from detail views.
  trackPageView({ source: `city_${city.slug}` });

  const when = (sp.when as DateFilter) || "today";
  const genreParam = sp.genre || "";
  const genreSlugs = genreParam.split(",").map((s) => s.trim()).filter(Boolean);
  const { from, to } = dateRangeFor(when);
  const nowIso = new Date().toISOString();

  const { data: cityVenues } = await supabase
    .from("venues")
    .select("id")
    .eq("city_id", city.id)
    .eq("approved", true);
  const venueIds = (cityVenues ?? []).map((v) => v.id);

  let genreEventIds: string[] | null = null;
  if (genreSlugs.length > 0) {
    const { data: genreRows } = await supabase
      .from("genres").select("id, slug").in("slug", genreSlugs);
    if (genreRows && genreRows.length > 0) {
      const { data: matchingIds } = await supabase
        .from("event_genres")
        .select("event_id")
        .in("genre_id", genreRows.map((g) => g.id));
      // Dedupe — an event tagged with two selected genres would otherwise appear twice
      genreEventIds = Array.from(new Set((matchingIds ?? []).map((r) => r.event_id)));
    } else {
      genreEventIds = [];
    }
  }

  // 1. Featured/pinned gigs (only those still upcoming + matching the date range)
  const { data: rawFeatured } = await supabase
    .from("events")
    .select(`*, venue:venues ( *, city:cities (*) ), event_genres ( genre:genres ( * ) )`)
    .in("venue_id", venueIds.length > 0 ? venueIds : ["00000000-0000-0000-0000-000000000000"])
    .gte("start_time", nowIso)
    .lte("start_time", to.toISOString())
    .eq("cancelled", false)
    .eq("status", "approved")
    .or(`end_time.is.null,end_time.gte.${nowIso}`)
    .gt("featured_until", nowIso)
    .order("start_time", { ascending: true })
    .limit(6);
  const featured: EventWithVenue[] = (rawFeatured ?? []).map((e: any) => ({
    ...e,
    genres: (e.event_genres ?? []).map((eg: any) => eg.genre).filter(Boolean),
  }));
  const featuredIds = new Set(featured.map((f) => f.id));

  // 2. Main listings
  let query = supabase
    .from("events")
    .select(`*, venue:venues ( *, city:cities (*) ), event_genres ( genre:genres ( * ) )`)
    .in("venue_id", venueIds.length > 0 ? venueIds : ["00000000-0000-0000-0000-000000000000"])
    .gte("start_time", from.toISOString())
    .lte("start_time", to.toISOString())
    .eq("cancelled", false)
    .eq("status", "approved")
    .or(`end_time.is.null,end_time.gte.${nowIso}`)
    .order("start_time", { ascending: true })
    // Scale the cap with the date range. "Today" rarely needs more than 60,
    // but "week" / "weekend" / "all upcoming" can run into hundreds once we
    // have a few months of FB-scraped gigs. 500 keeps things bounded without
    // hiding real gigs from the listing.
    .limit(when === "today" || when === "tonight" || when === "tomorrow" ? 100 : 500);

  if (genreEventIds !== null) {
    query = query.in("id", genreEventIds.length > 0 ? genreEventIds : ["00000000-0000-0000-0000-000000000000"]);
  }

  const { data: rawEvents } = await query;
  const nowDate = new Date();
  let events: EventWithVenue[] = (rawEvents ?? [])
    // Hide events that are over — uses end_time if set, else venue closing time
    .filter((e: any) => effectiveEndTime(e, e.venue).getTime() > nowDate.getTime())
    .map((e: any) => ({
      ...e,
      genres: (e.event_genres ?? []).map((eg: any) => eg.genre).filter(Boolean),
    }));

  // Genre takeover: when genre filter is active, gigs with active takeover come first
  if (genreSlugs.length > 0) {
    events = [...events].sort((a, b) => {
      const aTo = a.genre_takeover_until && new Date(a.genre_takeover_until).getTime() > Date.now();
      const bTo = b.genre_takeover_until && new Date(b.genre_takeover_until).getTime() > Date.now();
      if (aTo && !bTo) return -1;
      if (bTo && !aTo) return 1;
      return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
    });
  }

  const groupByDay = when === "week" || when === "weekend" || when === "all";
  const groups: Record<string, EventWithVenue[]> = {};
  if (groupByDay) {
    for (const e of events) {
      if (featuredIds.has(e.id)) continue; // don't double-show
      const dayKey = new Date(e.start_time).toDateString();
      (groups[dayKey] ||= []).push(e);
    }
  }

  const { data: venues } = await supabase
    .from("venues")
    .select("*")
    .eq("city_id", city.id)
    .eq("approved", true)
    .order("name");

  const dateLabel = formatDateRangeLabel(when);

  return (
    <div>
      <section className="border-b border-buzz-border bg-grain">
        <div className="container-page py-10 sm:py-14">
          <CitySwitcher cities={cities ?? []} current={city.slug} />
          <div className="mt-4 flex flex-col gap-2">
            <p className="eyebrow">{dateLabel} in</p>
            <h1 className="h-display text-5xl sm:text-7xl">
              {city.name}<span className="text-buzz-accent">.</span>
            </h1>
            {Array.isArray((city as any).nearby_areas) && (city as any).nearby_areas.length > 0 && (
              <p className="text-xs text-buzz-mute mt-1">
                Covering {(city as any).nearby_areas.join(", ")}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3 mt-1">
              <p className="text-buzz-mute">
                {events.length === 0
                  ? "Nothing matches that filter yet."
                  : `${events.length} ${events.length === 1 ? "gig" : "gigs"} found.`}
              </p>
              <Link href={`/${city.slug}/map`} className="text-sm text-buzz-accent hover:text-buzz-accent2">
                🗺️ Map view →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Paid sponsor banner — rotates through live Popular + Premium sponsors
          targeting this city (or nationwide). Silently disappears when none. */}
      <SponsorBanner citySlug={city.slug} />

      <div className="container-page py-8">
        <div className="mb-8">
          <Suspense fallback={<div className="card p-4 text-buzz-mute">Loading filters…</div>}>
            <EventFilters genres={genres ?? []} />
          </Suspense>
        </div>

        {/* Legend so parents know what the accessibility / sensory icons on
            each listing mean, with a link to the full guide. */}
        <div className="mb-8">
          <AccessibilityLegend />
        </div>

        {/* Featured / pinned gigs */}
        {featured.length > 0 && (
          <section className="mb-10">
            <p className="eyebrow mb-3">📌 Featured</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {featured.map((e) => <EventCard key={e.id} event={e} citySlug={city.slug} />)}
            </div>
          </section>
        )}

        {events.length === 0 ? (
          <div className="card p-12 text-center">
            <div className="text-5xl mb-3">🐝</div>
            <h2 className="h-display text-3xl mb-2">No buzz here yet</h2>
            <p className="text-buzz-mute max-w-md mx-auto">
              Try widening the date range or another genre. Or run a venue?{" "}
              <Link href="/signup" className="text-buzz-accent hover:text-buzz-accent2">List your gigs free</Link>.
            </p>
          </div>
        ) : (
          <EventsList
            events={events.filter((e) => !featuredIds.has(e.id))}
            citySlug={city.slug}
            groupByDay={groupByDay}
            groups={groupByDay ? Object.entries(groups).map(([dayKey, dayEvents]) => ({
              day: dayKey,
              date: new Date(dayKey),
              items: dayEvents,
            })) : undefined}
          />
        )}

        {venues && venues.length > 0 && (
          <section className="mt-20 pt-10 border-t border-buzz-border">
            <p className="eyebrow mb-2">The venues</p>
            <h2 className="h-display text-3xl sm:text-4xl mb-6">Where the music happens</h2>
            <CollapsibleVenueGrid venues={venues} citySlug={city.slug} />
          </section>
        )}
      </div>
    </div>
  );
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function shortDayLabel(d: Date) {
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  if (isToday) return "Today";
  if (isTomorrow) return "Tomorrow";
  return d.toLocaleDateString("en-GB", { weekday: "long" });
}

function longDayLabel(d: Date) {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}
