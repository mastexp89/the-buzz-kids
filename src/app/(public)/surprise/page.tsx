import { createClient } from "@/lib/supabase/server";
import { fetchPlaces, openDayKeysFor } from "@/lib/places";
import SurpriseMe, { type SurprisePlace } from "@/components/SurpriseMe";
import PlaceFilterBar from "@/components/PlaceFilterBar";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Surprise me — The Buzz Kids",
  description: "Can't decide? Give it a spin and we'll pick a kid-friendly day out for you.",
  alternates: { canonical: "/surprise" },
};

type Props = {
  searchParams: Promise<{ cat?: string; access?: string; toddler?: string; rain?: string; outdoor?: string; free?: string; other?: string; loc?: string; open?: string }>;
};

function ageLabel(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `Ages ${min}–${max}`;
  if (min != null) return `Ages ${min}+`;
  return `Up to ${max}s`;
}
function priceLabel(p: any): string | null {
  if (p.is_free) return "Free";
  if (p.price_from != null) return `From £${Number(p.price_from) % 1 === 0 ? Number(p.price_from) : Number(p.price_from).toFixed(2)}`;
  return null;
}

export default async function SurprisePage({ searchParams }: Props) {
  const supabase = await createClient();
  const sp = await searchParams;

  const [{ data: cityRows }, { data: genres }] = await Promise.all([
    supabase.from("cities").select("id, name, slug").eq("active", true).order("name"),
    supabase.from("genres").select("*").order("name"),
  ]);
  const cities = cityRows ?? [];

  const cats = (sp.cat || "").split(",").map((s) => s.trim()).filter(Boolean);
  const access = (sp.access || "").split(",").map((s) => s.trim()).filter(Boolean);
  // Location filter is multi-select: comma-separated slugs, or all active towns.
  const locs = (sp.loc || "").split(",").map((s) => s.trim()).filter(Boolean);
  const cityIds = locs.length
    ? cities.filter((c) => locs.includes(c.slug)).map((c) => c.id)
    : cities.map((c) => c.id);

  const raw = await fetchPlaces(supabase, {
    cityIds,
    catSlugs: cats,
    uncategorised: sp.other === "1",
    accessKeys: access,
    toddler: sp.toddler === "1",
    indoorOnly: sp.rain === "1",
    outdoorOnly: sp.outdoor === "1",
    freeOnly: sp.free === "1",
    openOnDays: openDayKeysFor(sp.open || "today"),
  });

  const places: SurprisePlace[] = raw.map((p: any) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    citySlug: p.city?.slug ?? "",
    cityName: p.city?.name ?? "",
    photo:
      p.cover_photo_url ||
      p.image_url ||
      (Array.isArray(p.gallery_image_urls) ? p.gallery_image_urls[0] : null) ||
      p.google_photo_url ||
      null,
    category: p.categories?.[0]?.name ?? null,
    age: ageLabel(p.age_min, p.age_max),
    price: priceLabel(p),
  }));

  return (
    <div className="container-page py-12 max-w-3xl">
      <div className="text-center mb-8">
        <p className="eyebrow mb-2">Can't decide?</p>
        <h1 className="h-display text-4xl sm:text-5xl">
          Let us pick<span className="text-buzz-accent">.</span>
        </h1>
        <p className="text-buzz-mute mt-2">
          Narrow it down if you like, then give it a spin — we'll land on a random day out.
        </p>
      </div>

      <div className="mb-6">
        <PlaceFilterBar genres={genres ?? []} cities={cities} />
      </div>

      {/* Remount when the filtered pool changes so the reel resets. */}
      <SurpriseMe key={places.map((p) => p.id).join(",")} places={places} />
    </div>
  );
}
