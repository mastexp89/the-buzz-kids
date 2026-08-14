import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import WhatsOnView from "@/components/WhatsOnView";
import { fetchCityEvents, safeJsonLd } from "@/lib/city-guide";
import { trackPageView } from "@/lib/track";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ city: string }> };

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

export async function generateMetadata({ params }: Props) {
  const { city } = await params;
  const name = cap(city);
  return {
    title: `What's on in ${name} for kids — The Buzz Kids`,
    description: `Kids' & family events in ${name} — galas, holiday clubs, workshops, theatre and days out, by date. See what's on this week and what's coming up.`,
    alternates: { canonical: `/${city}/whats-on` },
  };
}

export default async function CityWhatsOnPage({ params }: Props) {
  const supabase = await createClient();
  const { city: citySlug } = await params;

  const { data: city } = await supabase.from("cities").select("*").eq("slug", citySlug).single();
  if (!city || !city.active) notFound();

  const { data: { user } } = await supabase.auth.getUser();
  let isAdmin = false;
  if (user) {
    const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    isAdmin = prof?.role === "admin";
  }
  trackPageView({ source: `whatson_${city.slug}` });

  const events = await fetchCityEvents(supabase, city.slug);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `What's on in ${city.name} for kids`,
    itemListElement: events.slice(0, 30).map((e: any, i: number) => ({
      "@type": "ListItem",
      position: i + 1,
      name: e.title,
    })),
  };

  return (
    <div>
      <section className="border-b border-buzz-border bg-grain">
        <div className="container-page py-10 sm:py-14">
          <p className="eyebrow">
            <Link href={`/${city.slug}`} className="hover:text-buzz-accent">{city.name}</Link> · Kids&apos; events
          </p>
          <h1 className="h-display text-4xl sm:text-6xl">
            What&apos;s on in {city.name} for kids<span className="text-buzz-accent">.</span>
          </h1>
          <p className="text-buzz-mute mt-3 max-w-2xl">
            {events.length === 0
              ? `No kids' events listed in ${city.name} just now — check back soon, or `
              : `${events.length} kids' & family event${events.length === 1 ? "" : "s"} coming up in ${city.name} — galas, holiday clubs, workshops, theatre and days out. `}
            <Link href={`/${city.slug}`} className="text-buzz-accent hover:underline">browse places to go →</Link>
          </p>
        </div>
      </section>

      <div className="container-page py-8">
        {events.length === 0 ? (
          <div className="card p-12 text-center">
            <div className="text-5xl mb-3">📅</div>
            <h2 className="h-display text-3xl mb-2">Nothing on yet</h2>
            <p className="text-buzz-mute max-w-md mx-auto">We&apos;re still gathering {city.name} events — new ones are added all the time.</p>
          </div>
        ) : (
          <WhatsOnView events={events} cities={[{ name: city.name, slug: city.slug }]} isAdmin={isAdmin} />
        )}
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
    </div>
  );
}
