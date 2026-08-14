import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PlacesGrid from "@/components/PlacesGrid";
import { fetchPlaces } from "@/lib/places";
import { categoriesForCity, safeJsonLd } from "@/lib/city-guide";
import { trackPageView } from "@/lib/track";

export const dynamic = "force-dynamic";

// NOTE: this dynamic [category] segment sits alongside the static siblings
// `whats-on`, `map`, `venues`, `events` — Next resolves those static routes
// first, so this only handles genuine category slugs. Unknown slug or a city
// with no places in that category → 404 (no thin/empty pages get indexed).

type Props = { params: Promise<{ city: string; category: string }> };

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

export async function generateMetadata({ params }: Props) {
  const { city, category } = await params;
  const supabase = await createClient();
  const { data: g } = await supabase.from("genres").select("name").eq("slug", category).maybeSingle();
  if (!g) return {};
  const name = cap(city);
  return {
    title: `${g.name} in ${name} for kids — The Buzz Kids`,
    description: `${g.name} in ${name} for families & kids — browse places with opening times, prices, photos and reviews. Filter by age and accessibility.`,
    alternates: { canonical: `/${city}/${category}` },
  };
}

export default async function CityCategoryPage({ params }: Props) {
  const supabase = await createClient();
  const { city: citySlug, category } = await params;

  const [{ data: city }, { data: genre }] = await Promise.all([
    supabase.from("cities").select("*").eq("slug", citySlug).single(),
    supabase.from("genres").select("*").eq("slug", category).maybeSingle(),
  ]);
  if (!city || !city.active || !genre) notFound();

  const places = await fetchPlaces(supabase, { cityId: city.id, catSlugs: [genre.slug] });
  if (places.length === 0) notFound(); // never render an empty category page

  const { data: { user } } = await supabase.auth.getUser();
  let isAdmin = false;
  if (user) {
    const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    isAdmin = prof?.role === "admin";
  }
  trackPageView({ source: `cat_${city.slug}_${genre.slug}` });

  const others = (await categoriesForCity(supabase, city.id, 3))
    .filter((c) => c.slug !== genre.slug)
    .slice(0, 12);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${genre.name} in ${city.name}`,
    itemListElement: places.slice(0, 30).map((p: any, i: number) => ({
      "@type": "ListItem",
      position: i + 1,
      name: p.name,
    })),
  };

  return (
    <div>
      <section className="border-b border-buzz-border bg-grain">
        <div className="container-page py-10 sm:py-14">
          <p className="eyebrow">
            <Link href={`/${city.slug}`} className="hover:text-buzz-accent">{city.name}</Link> · Things to do
          </p>
          <h1 className="h-display text-4xl sm:text-6xl">
            {genre.name} in {city.name}<span className="text-buzz-accent">.</span>
          </h1>
          <p className="text-buzz-mute mt-3 max-w-2xl">
            {places.length} {genre.name.toLowerCase()} spot{places.length === 1 ? "" : "s"} for families in {city.name} — opening
            times, prices, photos and reviews. Filter by age and accessibility to plan your day out.
          </p>
        </div>
      </section>

      <div className="container-page py-8">
        <PlacesGrid places={places.map((p: any) => ({ ...p, city: { slug: city.slug } }))} isAdmin={isAdmin} />

        <div className="mt-10 border-t border-buzz-border pt-6">
          <h2 className="font-display text-2xl mb-3">More things to do in {city.name}</h2>
          <div className="flex flex-wrap gap-2">
            <Link href={`/${city.slug}/whats-on`} className="filter-pill">📅 What&apos;s on in {city.name}</Link>
            {others.map((c) => (
              <Link key={c.slug} href={`/${city.slug}/${c.slug}`} className="filter-pill">{c.name} ({c.count})</Link>
            ))}
            <Link href={`/${city.slug}`} className="filter-pill">All of {city.name} →</Link>
          </div>
        </div>
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
    </div>
  );
}
