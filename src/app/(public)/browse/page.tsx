import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PlaceCard from "@/components/PlaceCard";
import PlaceFilters from "@/components/PlaceFilters";
import WhatsOnView from "@/components/WhatsOnView";
import OffersView from "@/components/OffersView";
import { AccessibilityLegend } from "@/components/AccessibilityBadges";
import { fetchPlaces } from "@/lib/places";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Browse everywhere — The Buzz Kids",
  description:
    "Browse kid-friendly places to go across all our locations — filter by activity, age, price and accessibility.",
  alternates: { canonical: "/browse" },
};

type Props = {
  searchParams: Promise<{ tab?: string; cat?: string; access?: string; toddler?: string; rain?: string; outdoor?: string; free?: string; other?: string; loc?: string }>;
};

export default async function BrowsePage({ searchParams }: Props) {
  const supabase = await createClient();
  const sp = await searchParams;
  const tab = sp.tab === "events" || sp.tab === "deals" || sp.tab === "food" ? sp.tab : "places";
  const isEvents = tab === "events";
  const isOffers = tab === "deals" || tab === "food";

  // --- Offers / deals (food & days-out) ---
  let offers: any[] = [];
  if (isOffers) {
    const category = tab === "food" ? "food" : "days-out";
    const { data: offerRows } = await supabase
      .from("offers")
      .select("*")
      .eq("category", category)
      .eq("approved", true)
      .order("sort_order", { ascending: true });
    offers = offerRows ?? [];
  }

  const [{ data: cityRows }, { data: genres }] = await Promise.all([
    supabase.from("cities").select("id, name, slug").eq("active", true).order("name"),
    supabase.from("genres").select("*").order("name"),
  ]);
  const cities = cityRows ?? [];
  const activeIds = cities.map((c) => c.id);

  // --- What's On (dated events) ---
  let events: any[] = [];
  if (isEvents) {
    const nowIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const { data: eventRows } = await supabase
      .from("events")
      .select("*, venue:venues(*, city:cities(*)), city:cities(*), event_genres(genre:genres(*))")
      .or(`start_time.gte.${nowIso},end_time.gte.${nowIso}`)
      .order("start_time", { ascending: true })
      .limit(300);
    events = (eventRows ?? [])
      .filter((e: any) => {
        if (e.status && e.status !== "approved") return false;
        // Attached to a place → that place must be approved + its area live.
        // Standalone → the event's own area must be live.
        if (e.venue) return e.venue.approved && e.venue.city?.active;
        return e.city?.active;
      })
      .map((e: any) => ({
        ...e,
        genres: (e.event_genres ?? []).map((eg: any) => eg.genre).filter(Boolean),
      }));
  }

  const cats = (sp.cat || "").split(",").map((s) => s.trim()).filter(Boolean);
  const access = (sp.access || "").split(",").map((s) => s.trim()).filter(Boolean);
  const toddler = sp.toddler === "1";
  const rain = sp.rain === "1";
  const outdoor = sp.outdoor === "1";
  const free = sp.free === "1";
  const other = sp.other === "1";
  const loc = sp.loc || "";

  // Location filter: a single chosen town, or all active towns.
  let cityId: string | undefined;
  let cityIds: string[] | undefined;
  if (loc) {
    const c = cities.find((x) => x.slug === loc);
    cityId = c?.id;
    if (!cityId) cityIds = []; // unknown slug → no results
  } else {
    cityIds = activeIds;
  }

  const places = await fetchPlaces(supabase, {
    cityId,
    cityIds,
    catSlugs: cats,
    uncategorised: other,
    toddler,
    indoorOnly: rain,
    outdoorOnly: outdoor,
    freeOnly: free,
    accessKeys: access,
  });

  return (
    <div>
      <section className="border-b border-buzz-border bg-grain">
        <div className="container-page py-10 sm:py-14">
          <p className="eyebrow">Everywhere we cover</p>
          <h1 className="h-display text-5xl sm:text-7xl">
            {tab === "events" ? <>What&apos;s on<span className="text-buzz-accent">.</span></>
              : tab === "deals" ? <>Deals &amp; days out<span className="text-buzz-accent">.</span></>
              : tab === "food" ? <>Kids eat for less<span className="text-buzz-accent">.</span></>
              : <>Browse it all<span className="text-buzz-accent">.</span></>}
          </h1>
          <p className="text-buzz-mute mt-2">
            {tab === "events" ? "Galas, fayres, holiday clubs and special days out — by date."
              : tab === "deals" ? "Money-saving offers for family days out."
              : tab === "food" ? "Where the kids can eat free or for £1."
              : "Family days out, big and small — filter to find your perfect one."}
          </p>

          {/* Tabs */}
          <div className="mt-6 inline-flex flex-wrap gap-1 rounded-xl border border-buzz-border bg-buzz-card p-1">
            {[
              { href: "/browse", key: "places", label: "📍 Places" },
              { href: "/browse?tab=events", key: "events", label: "📅 What's on" },
              { href: "/browse?tab=deals", key: "deals", label: "🎟️ Deals" },
              { href: "/browse?tab=food", key: "food", label: "🍽️ Food" },
            ].map((t) => (
              <Link
                key={t.key}
                href={t.href}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === t.key ? "bg-buzz-accent text-white" : "text-buzz-mute hover:text-buzz-text"}`}
              >
                {t.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <div className="container-page py-8">
        {isOffers ? (
          <OffersView offers={offers} category={tab === "food" ? "food" : "days-out"} />
        ) : isEvents ? (
          <WhatsOnView events={events} cities={cities} />
        ) : (
          <>
            <div className="mb-8">
              <PlaceFilters genres={genres ?? []} cities={cities} />
            </div>
            <div className="mb-8">
              <AccessibilityLegend />
            </div>

            {places.length === 0 ? (
              <div className="card p-12 text-center">
                <div className="text-5xl mb-3">🐝</div>
                <h2 className="h-display text-3xl mb-2">Nothing here yet</h2>
                <p className="text-buzz-mute max-w-md mx-auto">
                  Try clearing a filter or picking a different area.
                </p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {places.map((p: any) => (
                  <PlaceCard key={p.id} place={p} citySlug={p.city?.slug ?? "dundee"} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
