import { createClient } from "@/lib/supabase/server";
import { fetchPlaces } from "@/lib/places";
import SurpriseMe, { type SurprisePlace } from "@/components/SurpriseMe";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Surprise me — The Buzz Kids",
  description: "Can't decide? Give it a spin and we'll pick a kid-friendly day out for you.",
  alternates: { canonical: "/surprise" },
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

export default async function SurprisePage() {
  const supabase = await createClient();
  const { data: cityRows } = await supabase.from("cities").select("id").eq("active", true);
  const activeIds = (cityRows ?? []).map((c) => c.id);
  const raw = await fetchPlaces(supabase, { cityIds: activeIds });

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
    <div className="container-page py-12 max-w-2xl">
      <div className="text-center mb-8">
        <p className="eyebrow mb-2">Can't decide?</p>
        <h1 className="h-display text-4xl sm:text-5xl">
          Let us pick<span className="text-buzz-accent">.</span>
        </h1>
        <p className="text-buzz-mute mt-2">
          Give it a spin and we'll land on a random day out — anywhere, or pick your area.
        </p>
      </div>
      <SurpriseMe places={places} />
    </div>
  );
}
