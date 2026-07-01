import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PlacesGrid from "@/components/PlacesGrid";
import PlaceFilterBar from "@/components/PlaceFilterBar";
import WhatsOnView from "@/components/WhatsOnView";
import OffersView from "@/components/OffersView";
import { AccessibilityLegend } from "@/components/AccessibilityBadges";
import { fetchPlaces, openDayKeysFor } from "@/lib/places";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Browse everywhere — The Buzz Kids",
  description:
    "Browse kid-friendly places to go across all our locations — filter by activity, age, price and accessibility.",
  alternates: { canonical: "/browse" },
};

type Props = {
  searchParams: Promise<{ tab?: string; cat?: string; access?: string; toddler?: string; rain?: string; outdoor?: string; free?: string; other?: string; loc?: string; open?: string; dog?: string }>;
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

  const [{ data: cityRows }, { data: genres }, { data: { user } }] = await Promise.all([
    supabase.from("cities").select("id, name, slug").eq("active", true).order("name"),
    supabase.from("genres").select("*").order("name"),
    supabase.auth.getUser(),
  ]);
  const cities = cityRows ?? [];
  const activeIds = cities.map((c) => c.id);

  // Admins get inline delete controls on the live browse views.
  let isAdmin = false;
  if (user) {
    const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    isAdmin = prof?.role === "admin";
  }

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
  // Location filter is multi-select: comma-separated slugs, or all active towns.
  const locs = (sp.loc || "").split(",").map((s) => s.trim()).filter(Boolean);
  const cityIds = locs.length
    ? cities.filter((c) => locs.includes(c.slug)).map((c) => c.id)
    : activeIds;

  // Carry the active place filters through to /surprise so a spin respects
  // whatever the parent has narrowed to. Only the params /surprise reads.
  const surpriseParams = new URLSearchParams();
  if (sp.cat) surpriseParams.set("cat", sp.cat);
  if (sp.access) surpriseParams.set("access", sp.access);
  if (sp.toddler === "1") surpriseParams.set("toddler", "1");
  if (sp.rain === "1") surpriseParams.set("rain", "1");
  if (sp.outdoor === "1") surpriseParams.set("outdoor", "1");
  if (sp.free === "1") surpriseParams.set("free", "1");
  if (sp.other === "1") surpriseParams.set("other", "1");
  if (sp.loc) surpriseParams.set("loc", sp.loc);
  if (sp.open) surpriseParams.set("open", sp.open);
  const surpriseQuery = surpriseParams.toString();

  const places = await fetchPlaces(supabase, {
    cityIds,
    catSlugs: cats,
    uncategorised: other,
    toddler,
    indoorOnly: rain,
    outdoorOnly: outdoor,
    freeOnly: free,
    accessKeys: access,
    openOnDays: openDayKeysFor(sp.open || "today"),
    dogOnly: sp.dog === "1",
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

          {/* Tabs — 2×2 grid on mobile, single row from sm up */}
          <div className="mt-6 grid grid-cols-2 sm:inline-flex sm:flex-row gap-1 rounded-xl border border-buzz-border bg-buzz-card p-1">
            {[
              { href: "/browse", key: "places", label: "📍 Places" },
              { href: "/browse?tab=events", key: "events", label: "📅 What's on" },
              { href: "/browse?tab=deals", key: "deals", label: "🎟️ Deals" },
              { href: "/browse?tab=food", key: "food", label: "🍽️ Food" },
            ].map((t) => (
              <Link
                key={t.key}
                href={t.href}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition text-center ${tab === t.key ? "bg-buzz-accent text-white" : "text-buzz-mute hover:text-buzz-text"}`}
              >
                {t.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <div className="container-page py-8">
        {isOffers ? (
          <OffersView offers={offers} category={tab === "food" ? "food" : "days-out"} isAdmin={isAdmin} />
        ) : isEvents ? (
          <WhatsOnView events={events} cities={cities} isAdmin={isAdmin} />
        ) : (
          <>
            <div className="mb-8">
              <PlaceFilterBar genres={genres ?? []} cities={cities} />
            </div>
            <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
              <AccessibilityLegend />
              {places.length > 1 && (
                <Link
                  href={`/surprise${surpriseQuery ? `?${surpriseQuery}` : ""}`}
                  className="btn-primary btn-lg shrink-0 shadow-md"
                  title="Can't choose? Spin for a random place from this list"
                >
                  🎲 Surprise me
                </Link>
              )}
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
              <PlacesGrid places={places} isAdmin={isAdmin} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
