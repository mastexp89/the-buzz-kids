import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PlacesGrid from "@/components/PlacesGrid";
import PlaceFilterBar from "@/components/PlaceFilterBar";
import WhatsOnView from "@/components/WhatsOnView";
import OffersView from "@/components/OffersView";
import WeatherStrip, { type WeatherArea } from "@/components/WeatherStrip";
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
      // Only the columns the event cards + client date/area filters use — was
      // `*, venue:venues(*)`, which shipped every heavy venue column (opening
      // hours, socials, google fields…) × 500 rows and made What's On slow to
      // load (~1.9MB → ~0.7MB).
      .select(
        "id, title, start_time, end_time, end_date, recurrence_pattern, recurrence_until, " +
        "highlighted_until, weekend_boost_until, cancelled, status, image_url, description, " +
        "age_min, age_max, is_free, cover_charge, accessibility, location_name, " +
        "venue:venues(id, name, slug, approved, address, latitude, longitude, cover_photo_url, image_url, gallery_image_urls, logo_url, google_photo_url, city:cities(slug, active, name)), " +
        "city:cities(slug, active, name), " +
        "event_genres(genre:genres(id, name, slug))",
      )
      // Filter to approved in the QUERY, not just in JS below — otherwise the
      // limit is filled by the ~1000 pending queue events (which have earlier
      // start dates), starving out approved events with later dates so they
      // never load into What's On at all.
      .eq("status", "approved")
      .eq("cancelled", false)
      .or(`start_time.gte.${nowIso},end_time.gte.${nowIso}`)
      .order("start_time", { ascending: true })
      .limit(500);
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

  // Weather for the Places tab: one row per selected location (max 3),
  // centred on the average of that area's place coordinates. Hidden when
  // browsing everywhere — no single forecast covers all of Scotland.
  function weatherAreasFor(list: any[]): WeatherArea[] {
    if (locs.length === 0 || locs.length > 3) return [];
    const sums = new Map<string, { lat: number; lon: number; n: number }>();
    for (const p of list) {
      const slug = p.city?.slug;
      if (!slug || !locs.includes(slug)) continue;
      const lat = Number(p.latitude), lon = Number(p.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const s = sums.get(slug) ?? { lat: 0, lon: 0, n: 0 };
      s.lat += lat; s.lon += lon; s.n++;
      sums.set(slug, s);
    }
    return locs
      .map((slug) => {
        const s = sums.get(slug);
        if (!s || s.n === 0) return null;
        return { label: cities.find((c) => c.slug === slug)?.name ?? slug, lat: s.lat / s.n, lon: s.lon / s.n };
      })
      .filter(Boolean) as WeatherArea[];
  }
  const fmtDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const weatherStart = fmtDay(new Date());
  const weatherEndD = new Date(); weatherEndD.setDate(weatherEndD.getDate() + 4);
  const weatherEnd = fmtDay(weatherEndD);

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
            {(() => {
              const wa = weatherAreasFor(places);
              return wa.length > 0 ? (
                <WeatherStrip areas={wa} startDate={weatherStart} endDate={weatherEnd} />
              ) : null;
            })()}
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
