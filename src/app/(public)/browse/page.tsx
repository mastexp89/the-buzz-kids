import { createClient } from "@/lib/supabase/server";
import PlaceCard from "@/components/PlaceCard";
import PlaceFilters from "@/components/PlaceFilters";
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
  searchParams: Promise<{ cat?: string; access?: string; toddler?: string; rain?: string; outdoor?: string; free?: string; loc?: string }>;
};

export default async function BrowsePage({ searchParams }: Props) {
  const supabase = await createClient();
  const sp = await searchParams;

  const [{ data: cityRows }, { data: genres }] = await Promise.all([
    supabase.from("cities").select("id, name, slug").eq("active", true).order("name"),
    supabase.from("genres").select("*").order("name"),
  ]);
  const cities = cityRows ?? [];
  const activeIds = cities.map((c) => c.id);

  const cats = (sp.cat || "").split(",").map((s) => s.trim()).filter(Boolean);
  const access = (sp.access || "").split(",").map((s) => s.trim()).filter(Boolean);
  const toddler = sp.toddler === "1";
  const rain = sp.rain === "1";
  const outdoor = sp.outdoor === "1";
  const free = sp.free === "1";
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
            Browse it all<span className="text-buzz-accent">.</span>
          </h1>
          <p className="text-buzz-mute mt-2">
            {places.length === 0
              ? "No places match that filter yet."
              : `${places.length} ${places.length === 1 ? "place" : "places"} across ${cities.length} ${cities.length === 1 ? "area" : "areas"}.`}
          </p>
        </div>
      </section>

      <div className="container-page py-8">
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
      </div>
    </div>
  );
}
