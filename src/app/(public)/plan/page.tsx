import { createClient } from "@/lib/supabase/server";
import { fetchPlaces } from "@/lib/places";
import PlaceCard from "@/components/PlaceCard";
import PlannerForm from "@/components/PlannerForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Find their buzz — plan a day out — The Buzz Kids",
  description: "Tell us their ages, budget and what they're into, and we'll line up kid-friendly ideas near you.",
  alternates: { canonical: "/plan" },
};

type Props = {
  searchParams: Promise<{ age?: string; budget?: string; setting?: string; cat?: string; access?: string; loc?: string; go?: string }>;
};

export default async function PlanPage({ searchParams }: Props) {
  const supabase = await createClient();
  const sp = await searchParams;

  const [{ data: cityRows }, { data: genres }] = await Promise.all([
    supabase.from("cities").select("id, name, slug").eq("active", true).order("name"),
    supabase.from("genres").select("*").order("name"),
  ]);
  const cities = cityRows ?? [];

  const cats = (sp.cat || "").split(",").map((s) => s.trim()).filter(Boolean);
  const access = (sp.access || "").split(",").map((s) => s.trim()).filter(Boolean);
  const go = sp.go === "1";

  let results: any[] = [];
  if (go) {
    const loc = sp.loc || "";
    let cityId: string | undefined;
    let cityIds: string[] | undefined;
    if (loc) {
      const c = cities.find((x) => x.slug === loc);
      cityId = c?.id;
      if (!cityId) cityIds = [];
    } else {
      cityIds = cities.map((c) => c.id);
    }
    const age = sp.age ? Number(sp.age) : NaN;
    results = await fetchPlaces(supabase, {
      cityId,
      cityIds,
      catSlugs: cats,
      accessKeys: access,
      suitableForAge: Number.isFinite(age) ? age : undefined,
      freeOnly: sp.budget === "free",
      maxPrice: sp.budget === "20" ? 20 : undefined,
      indoorOnly: sp.setting === "indoor",
      outdoorOnly: sp.setting === "outdoor",
    });
  }

  return (
    <div className="container-page py-12 max-w-3xl">
      <div className="text-center mb-8">
        <p className="eyebrow mb-2">Plan a day out</p>
        <h1 className="h-display text-4xl sm:text-5xl">
          Find their buzz<span className="text-buzz-accent">.</span>
        </h1>
        <p className="text-buzz-mute mt-2">Tell us a bit about them and we'll line up some ideas.</p>
      </div>

      <PlannerForm
        genres={genres ?? []}
        cities={cities}
        initial={{ age: sp.age ?? "", budget: sp.budget ?? "", setting: sp.setting ?? "", cats, access, loc: sp.loc ?? "" }}
      />

      {go && (
        <div className="mt-10">
          <h2 className="h-display text-2xl sm:text-3xl mb-4">
            {results.length === 0 ? "Hmm, nothing matched" : `${results.length} idea${results.length === 1 ? "" : "s"} for you`}
          </h2>
          {results.length === 0 ? (
            <p className="text-buzz-mute">Try loosening a filter — widen the budget, or pick "Either" for indoors/outdoors.</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-5">
              {results.map((p) => (
                <PlaceCard key={p.id} place={p} citySlug={p.city?.slug ?? "dundee"} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
