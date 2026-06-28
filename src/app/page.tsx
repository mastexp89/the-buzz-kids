import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import EventCard from "@/components/EventCard";
import SponsoredFestivalBanner from "@/components/SponsoredFestivalBanner";
import SponsorBanner from "@/components/SponsorBanner";
import AppBadges from "@/components/AppBadges";
import { dateRangeFor } from "@/lib/dateRange";
import { effectiveEndTime } from "@/lib/utils";
import { trackPageView } from "@/lib/track";
import type { EventWithVenue } from "@/lib/types";

export const dynamic = "force-dynamic";

// Format ["Dundee", "Angus"] -> "Dundee and Angus".
// ["Dundee", "Angus", "Aberdeen"] -> "Dundee, Angus and Aberdeen".
// Empty array returns "" so callers can guard.
function formatCityList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export default async function Home() {
  const supabase = await createClient();

  // Track homepage views — most visitors land here first, not on a
  // venue / event detail page, so skipping this kills the analytics
  // top-line. Fire-and-forget, bot filter applied inside.
  trackPageView({ source: "homepage" });

  const { data: cities } = await supabase.from("cities").select("*").order("name");

  // "What's on tonight" — fetched per active city so each section stays
  // city-pure (no mixing). Sections render only when their city has events.
  const activeCitiesForTonight = (cities ?? [])
    .filter((c) => c.active)
    .sort((a, b) => {
      // Dundee first (it's the largest catchment), then alphabetical.
      if (a.slug === "dundee") return -1;
      if (b.slug === "dundee") return 1;
      return a.name.localeCompare(b.name);
    });

  type CityTonight = { city: { id: string; slug: string; name: string }; events: EventWithVenue[] };
  const tonightByCity: CityTonight[] = [];

  for (const c of activeCitiesForTonight) {
    const { data: cityVenues } = await supabase
      .from("venues")
      .select("id")
      .eq("city_id", c.id)
      .eq("approved", true);
    const venueIds = (cityVenues ?? []).map((v) => v.id);
    if (venueIds.length === 0) {
      tonightByCity.push({ city: c, events: [] });
      continue;
    }

    const { from, to } = dateRangeFor("today");
    const now = new Date();
    const { data: rawEvents } = await supabase
      .from("events")
      .select(`*, venue:venues(*, city:cities(*)), event_genres(genre:genres(*))`)
      .in("venue_id", venueIds)
      .gte("start_time", from.toISOString())
      .lte("start_time", to.toISOString())
      .eq("cancelled", false)
      .eq("status", "approved")
      .order("start_time", { ascending: true })
      .limit(20);

    const events = (rawEvents ?? [])
      .filter((e: any) => effectiveEndTime(e, e.venue).getTime() > now.getTime())
      .slice(0, 6)
      .map((e: any) => ({
        ...e,
        genres: (e.event_genres ?? []).map((eg: any) => eg.genre).filter(Boolean),
      }));
    tonightByCity.push({ city: c, events });
  }

  // Spotlight venues (active venue spotlights, in active cities)
  const nowIso = new Date().toISOString();
  const { data: spotlightVenues } = await supabase
    .from("venues")
    .select("id, name, slug, logo_url, cover_photo_url, image_url, address, city:cities(name, slug, active)")
    .eq("approved", true)
    .gt("spotlight_until", nowIso)
    .order("spotlight_until", { ascending: false })
    .limit(6);
  const spotlight = (spotlightVenues ?? []).filter((v: any) => v.city?.active);

  const activeCities = (cities ?? []).filter((c) => c.active);
  const upcomingCities = (cities ?? []).filter((c) => !c.active);

  return (
    <div>
      <section className="relative overflow-hidden bg-grain border-b border-buzz-border">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-buzz-accent/10 via-transparent to-transparent" />
        <div className="container-page py-16 sm:py-24 grid md:grid-cols-[1fr_auto] gap-10 items-center">
          <div>
            <p className="eyebrow mb-3">Gigs · DJs · Nights out</p>
            <h1 className="h-display text-6xl sm:text-7xl md:text-8xl">
              Find the buzz<br />
              <span className="text-buzz-accent">tonight.</span>
            </h1>
            <p className="mt-6 text-buzz-mute max-w-xl text-lg">
              Real schedules from local pubs, clubs and venues. Gigs, DJs, karaoke,
              quizzes, sports screenings — filter by what you fancy and walk in.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {/* One "Browse <City>" button per active city. Dundee surfaces
                  first because it's the original / largest catchment; new
                  cities get added next to it as they go live. */}
              {[...activeCities]
                .sort((a, b) => {
                  if (a.slug === "dundee") return -1;
                  if (b.slug === "dundee") return 1;
                  return a.name.localeCompare(b.name);
                })
                .map((c) => (
                  <Link
                    key={c.id}
                    href={`/${c.slug}`}
                    className="btn-primary btn-lg"
                  >
                    Browse {c.name} →
                  </Link>
                ))}
              <Link href="/signup?as=venue" className="btn-secondary btn-lg">List your venue</Link>
            </div>
            <p className="mt-4 text-sm text-buzz-mute">
              Want to save your favourites and get notified about new gigs?{" "}
              <Link href="/signup?as=fan" className="text-buzz-accent hover:text-buzz-accent2 font-medium">
                ♡ Sign up free
              </Link>
            </p>
            {/* Only show the "we currently serve... expanding..." copy when
                more than one city is live. With a single live city the
                buttons + hero already convey it; mentioning expansion gives
                away cities the admin's prepping in private. */}
            {activeCities.length > 1 && (
              <p className="mt-6 text-sm text-buzz-mute max-w-xl">
                We currently serve {formatCityList(
                  [...activeCities]
                    .sort((a, b) => {
                      if (a.slug === "dundee") return -1;
                      if (b.slug === "dundee") return 1;
                      return a.name.localeCompare(b.name);
                    })
                    .map((c) => c.name),
                )}, with more areas being added all the time.
              </p>
            )}

            {/* App store badges — iOS live, Android in approval */}
            <div className="mt-6">
              <p className="text-xs uppercase tracking-wider text-buzz-mute mb-2">
                Get the app
              </p>
              <AppBadges size="hero" />
            </div>
          </div>
          <div className="hidden md:block relative w-[280px] h-[280px]">
            <Image
              src="/logo.png"
              alt="The Buzz Guide logo"
              fill
              priority
              className="object-contain drop-shadow-[0_0_60px_rgba(253,185,19,0.35)]"
            />
          </div>
        </div>
      </section>

      {/* Festival sponsor banner — only renders when a published festival is upcoming/active */}
      <SponsoredFestivalBanner />

      {/* Paid sponsor banner — rotates through live Popular + Premium sponsors.
          Silently disappears when nothing is running. */}
      <SponsorBanner />

      {/* One "Tonight in <City>" section per active city. Each section
          renders only when its city has events tonight. If neither city
          has anything, fall through to a single "Quiet day so far" card. */}
      {tonightByCity.some((c) => c.events.length > 0) ? (
        tonightByCity
          .filter((c) => c.events.length > 0)
          .map((entry) => (
            <section key={entry.city.id} className="container-page py-12 sm:py-16">
              <div className="flex items-end justify-between mb-6 gap-4">
                <div>
                  <p className="eyebrow mb-2">What's on today</p>
                  <h2 className="h-display text-4xl sm:text-5xl">
                    Tonight in {entry.city.name}
                  </h2>
                </div>
                <Link
                  href={`/${entry.city.slug}`}
                  className="text-sm text-buzz-accent hover:text-buzz-accent2 hidden sm:inline whitespace-nowrap"
                >
                  See all gigs →
                </Link>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {entry.events.map((e) => (
                  <EventCard key={e.id} event={e} citySlug={entry.city.slug} />
                ))}
              </div>
              <div className="mt-6 sm:hidden">
                <Link href={`/${entry.city.slug}`} className="btn-secondary w-full">
                  See all gigs →
                </Link>
              </div>
            </section>
          ))
      ) : (
        <section className="container-page py-12 sm:py-16">
          <div className="card p-10 text-center">
            <p className="eyebrow mb-2">What's on today</p>
            <h2 className="h-display text-3xl sm:text-4xl mb-2">Quiet day so far</h2>
            <p className="text-buzz-mute max-w-md mx-auto">
              Nothing listed for tonight yet. Check back later, or browse what's coming up this week.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {activeCitiesForTonight.map((c) => (
                <Link key={c.id} href={`/${c.slug}?when=week`} className="btn-primary">
                  Browse {c.name} this week →
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {spotlight.length > 0 && (
        <section className="container-page py-12 sm:py-16 border-t border-buzz-border">
          <div className="flex items-end justify-between mb-6 gap-4">
            <div>
              <p className="eyebrow mb-2">🔦 Spotlight</p>
              <h2 className="h-display text-4xl sm:text-5xl">Featured venues</h2>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {spotlight.map((v: any) => (
              <Link
                key={v.id}
                href={`/${v.city?.slug ?? "dundee"}/venues/${v.slug}`}
                className="card-hover p-5 flex gap-3 items-center lift border-buzz-accent/40"
              >
                {(v.logo_url || v.cover_photo_url || v.image_url) ? (
                  <div
                    className="w-16 h-16 rounded-xl bg-buzz-surface shrink-0"
                    style={{
                      backgroundImage: `url(${v.logo_url || v.cover_photo_url || v.image_url})`,
                      // logo_url / cover_photo_url are usually square branded — contain
                      // keeps them whole. image_url is wider — cover crops cleanly.
                      backgroundSize: (v.logo_url || v.cover_photo_url) ? "contain" : "cover",
                      backgroundPosition: "center",
                      backgroundRepeat: "no-repeat",
                    }}
                  />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-buzz-surface border border-buzz-border grid place-items-center text-2xl shrink-0">🐝</div>
                )}
                <div className="min-w-0">
                  <div className="font-display text-xl uppercase truncate leading-tight">{v.name}</div>
                  <div className="text-xs text-buzz-mute truncate">{v.city?.name}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="container-page py-12 sm:py-16 border-t border-buzz-border">
        <div className="text-center mb-10">
          <p className="eyebrow mb-2">How it works</p>
          <h2 className="h-display text-4xl sm:text-5xl">Three steps. Walk in.</h2>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { n: "01", t: "Pick your city", d: "Pick your local — we cover Scottish cities and we're rolling out fast." },
            { n: "02", t: "Filter your night", d: "Genre, date, venue. We'll show you what's on." },
            { n: "03", t: "Walk in", d: "Cover, set times, address. No middlemen, no booking fees." },
          ].map((s) => (
            <div key={s.n} className="card p-6 lift">
              <div className="font-display text-5xl text-buzz-accent leading-none mb-3">{s.n}</div>
              <h3 className="font-display text-xl uppercase mb-2">{s.t}</h3>
              <p className="text-sm text-buzz-mute">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Fan signup CTA — softer, more colourful card. Positioned before the
          venue/artist CTA so fans reading top-down see "this is for me"
          before "list your business". Most homepage visitors are fans. */}
      <section className="container-page pt-6">
        <div className="relative overflow-hidden rounded-3xl border border-buzz-accent/30 bg-buzz-card p-10 sm:p-14 text-center">
          <p className="text-xs uppercase tracking-[0.2em] font-bold mb-2 text-buzz-accent">For music fans</p>
          <h2 className="h-display text-4xl sm:text-5xl mb-3">
            Never miss a gig you'd love.
          </h2>
          <p className="max-w-xl mx-auto text-buzz-mute mb-6">
            Heart your favourite venues, bands and gigs. We'll email you when they
            announce something new, send a morning digest of what you've saved for the
            day, and ping you 15 minutes before each gig kicks off. Free, no spam.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/signup?as=fan"
              className="inline-flex items-center gap-2 rounded-lg bg-buzz-accent text-black font-bold px-6 py-3 hover:opacity-90 transition"
            >
              ♡ Sign up free →
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-lg bg-transparent text-buzz-text font-semibold px-6 py-3 hover:bg-buzz-surface transition border-2 border-buzz-border"
            >
              I already have an account
            </Link>
          </div>
        </div>
      </section>

      <section className="container-page pb-20 pt-6">
        <div className="relative overflow-hidden rounded-3xl bg-buzz-accent text-black p-10 sm:p-14 text-center">
          <div className="absolute -top-8 -right-8 w-48 h-48 opacity-10">
            <Image src="/logo.png" alt="" fill className="object-contain" />
          </div>
          <p className="text-xs uppercase tracking-[0.2em] font-bold mb-2">For venues, artists, DJs, organisers</p>
          <h2 className="h-display text-4xl sm:text-5xl mb-3">List your gigs.<br />Free, forever.</h2>
          <p className="max-w-lg mx-auto text-black/80 mb-6">
            Free for venues, artists, bands, DJs and event organisers. Reach locals looking for a night out tonight, this weekend, and beyond. Optional paid promotions if you want a gig pinned or featured.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup?as=venue" className="inline-flex items-center gap-2 rounded-lg bg-black text-buzz-accent font-bold px-6 py-3 hover:bg-buzz-bg transition">
              List your venue free →
            </Link>
            <Link href="/signup?as=artist" className="inline-flex items-center gap-2 rounded-lg bg-transparent text-black font-semibold px-6 py-3 hover:bg-black/10 transition border-2 border-black/30">
              I'm an artist / DJ
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
