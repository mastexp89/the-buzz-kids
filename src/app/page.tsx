import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { trackPageView } from "@/lib/track";

export const dynamic = "force-dynamic";

export default async function Home() {

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
          <Link href="/list-your-activity" className="inline-flex items-center gap-2 rounded-lg bg-white text-buzz-accent font-bold px-6 py-3 hover:bg-white/90 transition">
            List an activity free →
          </Link>
        </div>
      </section>
    </div>
  );
}
