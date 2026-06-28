import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { trackPageView } from "@/lib/track";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Coming-soon holding page
// ---------------------------------------------------------------------------
// Set COMING_SOON=true in Vercel env vars to show this instead of the full
// homepage. All other routes (admin, city pages, auth) stay accessible.
// Remove the env var (or set it to anything other than "true") to launch.
// ---------------------------------------------------------------------------
async function ComingSoon() {
  const supabase = await createClient();
  const { data: cities } = await supabase
    .from("cities")
    .select("name, slug, active")
    .order("name");
  const active = (cities ?? []).filter((c) => c.active);
  const upcoming = (cities ?? []).filter((c) => !c.active);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-grain px-6 py-20 text-center">
      <div className="mb-8 relative w-28 h-28 sm:w-36 sm:h-36">
        <Image src="/logo.png" alt="The Buzz Kids" fill className="object-contain" priority />
      </div>

      <p className="eyebrow mb-3">Coming soon</p>

      <h1 className="h-display text-5xl sm:text-7xl mb-4 leading-none">
        <span className="text-buzz-text">The Buzz </span>
        <span style={{ color: "#EC1E8C" }}>K</span>
        <span style={{ color: "#1FA9E0" }}>i</span>
        <span style={{ color: "#6FA713" }}>d</span>
        <span style={{ color: "#F9A11B" }}>s</span>
        <span style={{ color: "#EC1E8C" }}>.</span>
      </h1>

      <p className="text-buzz-mute text-lg sm:text-xl max-w-lg mb-8">
        Scotland's new family days-out guide — soft play, farms, holiday clubs,
        museums and more. Filter by age, price and whether the sun's out.
      </p>

      {active.length > 0 && (
        <div className="mb-8">
          <p className="text-sm text-buzz-mute mb-3">Launching in</p>
          <div className="flex flex-wrap justify-center gap-2">
            {active.map((c) => (
              <span
                key={c.slug}
                className="filter-pill pointer-events-none"
              >
                📍 {c.name}
              </span>
            ))}
          </div>
          {upcoming.length > 0 && (
            <p className="text-xs text-buzz-mute mt-3">
              More areas to follow — {upcoming.map((c) => c.name).join(", ")} and beyond.
            </p>
          )}
        </div>
      )}

      <p className="text-buzz-mute text-sm max-w-md mb-2">
        Run a soft play, farm, library or holiday club?
      </p>
      <Link
        href="/signup?as=venue"
        className="btn-primary"
      >
        List your place free — be first in the directory →
      </Link>

      <p className="mt-10 text-xs text-buzz-mute/50">
        A sister site to{" "}
        <a href="https://www.thebuzzguide.co.uk" target="_blank" rel="noopener" className="hover:text-buzz-mute transition">
          The Buzz Guide
        </a>
        . Designed by{" "}
        <a href="https://www.forthhost.com" target="_blank" rel="noopener" className="hover:text-buzz-mute transition">
          Forth Host &amp; Web Design
        </a>
        .
      </p>
    </div>
  );
}


export default async function Home() {
  if (process.env.COMING_SOON === "true") return <ComingSoon />;

  const supabase = await createClient();
  trackPageView({ source: "homepage" });

  const [{ data: cityRows }, { data: spotlightVenues }] = await Promise.all([
    supabase.from("cities").select("name, slug").eq("active", true).order("name"),
    supabase
      .from("venues")
      .select("id, name, slug, logo_url, cover_photo_url, image_url, city:cities(name, slug, active)")
      .eq("approved", true)
      .gt("spotlight_until", new Date().toISOString())
      .order("spotlight_until", { ascending: false })
      .limit(6),
  ]);

  const activeCities = cityRows ?? [];
  const spotlight = (spotlightVenues ?? []).filter((v: any) => v.city?.active);

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-grain border-b border-buzz-border">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-buzz-accent/10 via-transparent to-transparent" />
        <div className="container-page py-16 sm:py-24 grid md:grid-cols-[1fr_auto] gap-10 items-center">
          <div>
            <p className="eyebrow mb-3">Things to do · Places to go · Memories to make</p>
            <h1 className="h-display text-6xl sm:text-7xl md:text-8xl">
              Find their<br />
              <span style={{ color: "#EC1E8C" }}>b</span>
              <span style={{ color: "#1FA9E0" }}>u</span>
              <span style={{ color: "#6FA713" }}>z</span>
              <span style={{ color: "#F9A11B" }}>z</span>
              <span style={{ color: "#EC1E8C" }}>.</span>
            </h1>
            <p className="mt-6 text-buzz-mute max-w-xl text-lg">
              Scotland's family days-out guide — soft play, farms, museums, holiday
              clubs and more. Filter by age, price and whether it's raining.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/browse" className="btn-primary btn-lg">Browse activities →</Link>
              <Link href="/surprise" className="btn-secondary btn-lg">🎲 Surprise me</Link>
            </div>
            <p className="mt-4 text-sm text-buzz-mute">
              Want to save to your bucket list and get holiday alerts?{" "}
              <Link href="/signup?as=fan" className="text-buzz-accent hover:text-buzz-accent2 font-medium">
                ♡ Sign up free
              </Link>
            </p>
            {activeCities.length > 0 && (
              <p className="mt-5 text-xs text-buzz-mute">
                Covering {activeCities.map((c) => c.name).join(", ")} — more areas added regularly.
              </p>
            )}
          </div>
          <div className="hidden md:block relative w-[280px] h-[280px]">
            <Image src="/logo.png" alt="The Buzz Kids logo" fill priority sizes="280px" className="object-contain" />
          </div>
        </div>
      </section>

      {/* Spotlight */}
      {spotlight.length > 0 && (
        <section className="container-page py-12 sm:py-16 border-t border-buzz-border">
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

      {/* How it works */}
      <section className="container-page py-12 sm:py-16 border-t border-buzz-border">
        <div className="text-center mb-10">
          <p className="eyebrow mb-2">How it works</p>
          <h2 className="h-display text-4xl sm:text-5xl">Three steps. Day sorted.</h2>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { n: "01", t: "Browse everything", d: "All our areas in one place — filter by activity type, age, price and accessibility." },
            { n: "02", t: "Filter for your kids", d: "Narrow it down to what fits — indoor, outdoor, toddler-friendly, sensory-friendly." },
            { n: "03", t: "Go have fun", d: "Times, prices, booking links and accessibility info — all in one place." },
          ].map((s) => (
            <div key={s.n} className="card p-6 lift">
              <div className="font-display text-5xl text-buzz-accent leading-none mb-3">{s.n}</div>
              <h3 className="font-display text-xl uppercase mb-2">{s.t}</h3>
              <p className="text-sm text-buzz-mute">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

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
          <Link href="/signup?as=venue" className="inline-flex items-center gap-2 rounded-lg bg-white text-buzz-accent font-bold px-6 py-3 hover:bg-white/90 transition">
            List an activity free →
          </Link>
        </div>
      </section>
    </div>
  );
}
