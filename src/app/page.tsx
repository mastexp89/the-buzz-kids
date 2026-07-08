import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { trackPageView } from "@/lib/track";
import { getLiveSponsors, SponsorCards } from "@/components/SponsorBanner";

export const dynamic = "force-dynamic";

export default async function Home() {

  const supabase = await createClient();
  trackPageView({ source: "homepage" });

  const { data: spotlightVenues } = await supabase
    .from("venues")
    .select("id, name, slug, logo_url, cover_photo_url, image_url, city:cities(name, slug, active)")
    .eq("approved", true)
    .gt("spotlight_until", new Date().toISOString())
    .order("spotlight_until", { ascending: false })
    .limit(6);

  const spotlight = (spotlightVenues ?? []).filter((v: any) => v.city?.active);

  // Family favourites — the app's "top-rated" strip, mirrored on the web.
  // Highest Google ratings with a meaningful review count, across live areas.
  const { data: topRated } = await supabase
    .from("venues")
    .select("id, name, slug, cover_photo_url, image_url, google_photo_url, google_rating, google_rating_count, city:cities(name, slug, active)")
    .eq("approved", true)
    .in("venue_type", ["attraction", "both"])
    .not("google_rating", "is", null)
    .gte("google_rating_count", 100)
    .order("google_rating", { ascending: false })
    .order("google_rating_count", { ascending: false })
    .limit(12);
  const favourites = (topRated ?? []).filter((v: any) => v.city?.active).slice(0, 8);

  // One pick of up to 4 sponsors, split 2 above / 2 below the nav tiles —
  // impressions are counted once here for all shown cards.
  const sponsors = await getLiveSponsors(4);
  const adsTop = sponsors.slice(0, 2);
  const adsBottom = sponsors.slice(2, 4);

  return (
    <div>
      {/* Compact hero — headline + strapline only. The tiles below ARE the
          navigation (like the app), so no separate browse buttons; everything
          important sits in the first viewport. */}
      <section className="relative overflow-hidden bg-grain">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-buzz-accent/10 via-transparent to-transparent" />
        <div className="container-page pt-8 sm:pt-12 pb-2 flex items-center justify-center gap-5">
          <div className="relative w-20 h-20 sm:w-28 sm:h-28 shrink-0">
            <Image src="/logo.png" alt="The Buzz Kids logo" fill priority sizes="112px" className="object-contain" />
          </div>
          <div className="min-w-0">
            <h1 className="h-display text-4xl sm:text-6xl leading-none">
              Find their{" "}
              <span style={{ color: "#EC1E8C" }}>b</span>
              <span style={{ color: "#1FA9E0" }}>u</span>
              <span style={{ color: "#6FA713" }}>z</span>
              <span style={{ color: "#F9A11B" }}>z</span>
              <span style={{ color: "#EC1E8C" }}>.</span>
            </h1>
            <p className="mt-1.5 text-buzz-mute text-sm sm:text-base">
              Things to do · Places to go · Memories to make
            </p>
          </div>
        </div>
      </section>

      {/* Quick-nav tiles — mirrors the app's home dashboard so web + app feel
          like one product. Four big thumbable destinations in brand colours,
          in the FIRST viewport (people don't scroll to find navigation). */}
      <section className="container-page pt-5 pb-10 sm:pb-14">
        {/* Mobile only: two sponsor cards above the nav tiles. On desktop all
            four ads sit in one row under the grid instead. */}
        {adsTop.length > 0 && (
          <SponsorCards sponsors={adsTop} className="lg:hidden max-w-3xl mx-auto mb-4 sm:mb-5" />
        )}

        {/* 2×2 phone grid (app-like); one slim 4-across band on desktop so
            the tiles read as navigation, not giant slabs. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 max-w-3xl lg:max-w-6xl mx-auto">
          {[
            { href: "/browse", emoji: "🗺️", title: "Places to go", sub: "Soft plays · farms · parks · museums etc", bg: "#EC1E8C" },
            { href: "/browse?tab=events", emoji: "📅", title: "What's on", sub: "Kids clubs · football camps · Bookbug etc", bg: "#1FA9E0" },
            { href: "/browse?tab=deals", emoji: "🎟️🍔", title: "Deals", sub: "Kids eat free · vouchers · money off tickets etc", bg: "#F9A11B" },
            { emoji: "🏡", title: "Places to stay", sub: "Family-friendly stays & getaways", bg: "#6FA713", comingSoon: true },
          ].map((t: any) =>
            t.comingSoon ? (
              <div
                key={t.title}
                className="relative rounded-3xl p-5 sm:p-6 text-white overflow-hidden opacity-90"
                style={{ backgroundColor: t.bg }}
              >
                <div className="w-14 h-14 rounded-2xl bg-white grid place-items-center text-3xl mb-3.5 shadow-sm">
                  <span aria-hidden>{t.emoji}</span>
                </div>
                <span className="absolute top-4 right-4 rounded-full bg-white/90 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1" style={{ color: t.bg }}>
                  Coming soon
                </span>
                <h3 className="font-display text-2xl leading-none mb-1.5">{t.title}</h3>
                <p className="text-[13px] text-white/90 leading-snug">{t.sub}</p>
              </div>
            ) : (
              <Link
                key={t.href}
                href={t.href}
                className="group relative rounded-3xl p-5 sm:p-6 text-white overflow-hidden transition hover:scale-[1.02] hover:shadow-xl"
                style={{ backgroundColor: t.bg }}
              >
                <div className={`h-14 rounded-2xl bg-white grid place-items-center mb-3.5 shadow-sm ${t.emoji.length > 2 ? "w-[4.5rem] text-2xl" : "w-14 text-3xl"}`}>
                  <span aria-hidden className="tracking-tighter">{t.emoji}</span>
                </div>
                <span className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/25 grid place-items-center text-white text-sm group-hover:translate-x-0.5 transition" aria-hidden>
                  ›
                </span>
                <h3 className="font-display text-2xl leading-none mb-1.5">{t.title}</h3>
                <p className="text-[13px] text-white/90 leading-snug">{t.sub}</p>
              </Link>
            ),
          )}
        </div>

        {/* Quick actions — same pair as the app */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 max-w-3xl lg:max-w-xl mx-auto">
          <Link href="/surprise" className="card-hover lift rounded-2xl py-3 px-5 text-center font-bold">
            🎲 Surprise me
          </Link>
          <Link href="/dashboard/favourites" className="card-hover lift rounded-2xl py-3 px-5 text-center font-bold">
            🖤 Bucket list
          </Link>
        </div>
      </section>

      {/* …and two below the tiles on mobile; on desktop this row carries all
          four ads, 4-across at the same width as the tile band. */}
      {sponsors.length > 0 && (
        <section className="container-page pb-8">
          <div className="lg:hidden">
            <SponsorCards sponsors={adsBottom} className="max-w-3xl mx-auto" />
          </div>
          <div className="hidden lg:block">
            <SponsorCards sponsors={sponsors} className="lg:max-w-6xl mx-auto" />
          </div>
        </section>
      )}

      {/* Spotlight (paid featured places) */}
      {spotlight.length > 0 && (
        <section className="container-page pb-10 sm:pb-14">
          <p className="eyebrow mb-2">🔦 Spotlight</p>
          <h2 className="h-display text-4xl sm:text-5xl mb-6">Featured places</h2>
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

      {/* Family favourites — top-rated places, like the app's home strip. */}
      {favourites.length > 0 && (
        <section className="container-page pb-12 sm:pb-16">
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <h2 className="h-display text-4xl sm:text-5xl">Family favourites</h2>
            <Link href="/browse" className="text-sm text-buzz-accent hover:text-buzz-accent2 font-medium shrink-0">See all →</Link>
          </div>
          <p className="text-buzz-mute mb-5">⭐ The places local families rate highest</p>
          <div className="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 snap-x">
            {favourites.map((v: any) => {
              const photo = v.cover_photo_url || v.image_url || v.google_photo_url;
              return (
                <Link
                  key={v.id}
                  href={`/${v.city?.slug ?? "dundee"}/venues/${v.slug}`}
                  className="group w-56 shrink-0 snap-start card-hover lift overflow-hidden rounded-2xl"
                >
                  <div
                    className="relative h-32 bg-buzz-surface"
                    style={photo ? { backgroundImage: `url(${photo})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
                  >
                    {!photo && <div className="absolute inset-0 grid place-items-center text-4xl opacity-60" aria-hidden>🐝</div>}
                    <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/60 backdrop-blur-sm text-white text-[11px] font-semibold px-2 py-1">
                      <span className="text-amber-400" aria-hidden>★</span>
                      {Number(v.google_rating).toFixed(1)}
                      <span className="text-white/70 font-normal">({v.google_rating_count})</span>
                    </span>
                  </div>
                  <div className="p-3">
                    <div className="font-display text-lg uppercase leading-tight truncate group-hover:text-buzz-accent transition">{v.name}</div>
                    <div className="text-xs text-buzz-mute truncate">{v.city?.name}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Parent CTA */}
      <section className="container-page pt-6">
        <div className="relative overflow-hidden rounded-3xl border border-buzz-accent/30 bg-buzz-card p-10 sm:p-14 text-center">
          <p className="text-xs uppercase tracking-[0.2em] font-bold mb-2 text-buzz-accent">For parents &amp; carers</p>
          <h2 className="h-display text-4xl sm:text-5xl mb-3">Never miss a great day out.</h2>
          <p className="max-w-xl mx-auto text-buzz-mute mb-6">
            Save places to your bucket list, leave reviews for other parents and get
            alerts when new sessions drop for the school holidays. Free, no spam.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup?as=fan" className="inline-flex items-center gap-2 rounded-lg bg-buzz-accent text-white font-bold px-6 py-3 hover:opacity-90 transition">
              ♡ Sign up free →
            </Link>
            <Link href="/login" className="inline-flex items-center gap-2 rounded-lg bg-transparent text-buzz-text font-semibold px-6 py-3 hover:bg-buzz-surface transition border-2 border-buzz-border">
              I already have an account
            </Link>
          </div>
        </div>
      </section>

      {/* Provider CTA */}
      <section className="container-page pb-20 pt-6">
        <div className="relative overflow-hidden rounded-3xl bg-buzz-accent text-white p-10 sm:p-14 text-center">
          <div className="absolute -top-8 -right-8 w-48 h-48 opacity-10">
            <Image src="/logo.png" alt="" fill className="object-contain" />
          </div>
          <p className="text-xs uppercase tracking-[0.2em] font-bold mb-2">For clubs, places &amp; activity providers</p>
          <h2 className="h-display text-4xl sm:text-5xl mb-3">List your activities.<br />Free, forever.</h2>
          <p className="max-w-lg mx-auto text-white/85 mb-6">
            Free for soft plays, farms, libraries, leisure trusts, theatres and holiday-club providers.
            Reach local families looking for things to do — this weekend, this holiday and beyond.
          </p>
          <Link href="/list-your-activity" className="inline-flex items-center gap-2 rounded-lg bg-white text-buzz-accent font-bold px-6 py-3 hover:bg-white/90 transition">
            List an activity free →
          </Link>
        </div>
      </section>
    </div>
  );
}
