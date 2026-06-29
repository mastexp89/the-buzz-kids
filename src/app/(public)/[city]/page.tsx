import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AccessibilityLegend } from "@/components/AccessibilityBadges";
import PlaceCard from "@/components/PlaceCard";
import PlaceFilters from "@/components/PlaceFilters";
import CitySwitcher from "@/components/CitySwitcher";
import { fetchPlaces } from "@/lib/places";
import { trackPageView } from "@/lib/track";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ city: string }>;
  searchParams: Promise<{ cat?: string; access?: string; toddler?: string; rain?: string; outdoor?: string; free?: string; other?: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { city } = await params;
  return {
    title: `Things to do with kids in ${cap(city)} — The Buzz Kids`,
    description: `Family days out and kids' activities in ${cap(city)} — soft play, holiday clubs, farms, theatre and more. Filter by age, price, indoor or outdoor.`,
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

  // One combined directory of places (attractions + venues open to visit),
  // narrowed by the place filters.
  const placeCats = (sp.cat || "").split(",").map((s) => s.trim()).filter(Boolean);
  const placeAccess = (sp.access || "").split(",").map((s) => s.trim()).filter(Boolean);
  const places = await fetchPlaces(supabase, {
    cityId: city.id,
    catSlugs: placeCats,
    uncategorised: sp.other === "1",
    toddler: sp.toddler === "1",
    indoorOnly: sp.rain === "1",
    outdoorOnly: sp.outdoor === "1",
    freeOnly: sp.free === "1",
    accessKeys: placeAccess,
  });

  return (
    <div>
      <section className="border-b border-buzz-border bg-grain">
        <div className="container-page py-10 sm:py-14">
          <CitySwitcher cities={cities ?? []} current={city.slug} />
          <div className="mt-4 flex flex-col gap-2">
            <p className="eyebrow">Things to do in</p>
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
                {places.length === 0
                  ? "Nothing listed here yet."
                  : "Places to explore."}
              </p>
              <Link href={`/${city.slug}/map`} className="text-sm text-buzz-accent hover:text-buzz-accent2">
                🗺️ Map view →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* One combined directory — places + activities, narrow with the filters. */}
      <div className="container-page py-8">
        <div className="mb-8">
          <PlaceFilters genres={genres ?? []} />
        </div>
        <div className="mb-8">
          <AccessibilityLegend />
        </div>
        {places.length === 0 ? (
          <div className="card p-12 text-center">
            <div className="text-5xl mb-3">🐝</div>
            <h2 className="h-display text-3xl mb-2">Nothing here yet</h2>
            <p className="text-buzz-mute max-w-md mx-auto">
              We're still adding {city.name} spots. Run a soft play, farm, club or activity?{" "}
              <Link href="/list-your-activity" className="text-buzz-accent hover:text-buzz-accent2">List your place free</Link>.
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {places.map((p: any) => <PlaceCard key={p.id} place={p} citySlug={city.slug} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
