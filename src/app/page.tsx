import Link from "next/link";
import { Fredoka, Nunito, Caveat } from "next/font/google";
import { createClient } from "@/lib/supabase/server";
import { trackPageView } from "@/lib/track";
import HeroSearch from "@/components/HeroSearch";
import NewsletterInline from "@/components/NewsletterInline";
import FavouriteButton from "@/components/FavouriteButton";

// Redesign preview: rounded, friendly display face (Fredoka) + warm body
// (Nunito) + a handwritten accent (Caveat), replacing the condensed-caps look.
const fredoka = Fredoka({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-fredoka", display: "swap" });
const nunito = Nunito({ subsets: ["latin"], weight: ["400", "600", "700", "800", "900"], variable: "--font-nunito", display: "swap" });
const caveat = Caveat({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-caveat", display: "swap" });

export const dynamic = "force-dynamic";

const DISPLAY = { fontFamily: "var(--font-fredoka)" } as const;
const HAND = { fontFamily: "var(--font-caveat)" } as const;

export default async function Home() {
  const supabase = await createClient();
  trackPageView({ source: "homepage" });

  const { data: { user } } = await supabase.auth.getUser();

  // Top picks — real top-rated places that have a re-hosted (reliable) photo.
  // Named venues keep their OWN photography; the design assets are never used
  // for a specific business (see the photo pack README).
  // image_source 'commons' = a real Wikimedia PHOTOGRAPH of the actual place
  // (never a logo / graphic), so these always show a proper photo. Most-
  // reviewed flagship attractions first.
  const { data: picksData } = await supabase
    .from("venues")
    .select("id, name, slug, description, cover_photo_url, city:cities(name, slug, active)")
    .eq("approved", true)
    .in("venue_type", ["attraction", "both"])
    .eq("image_source", "commons")
    .not("cover_photo_url", "is", null)
    .gte("google_rating_count", 200)
    .order("google_rating_count", { ascending: false, nullsFirst: false })
    .limit(14);
  const picks = (picksData ?? [])
    .filter((v: any) => v.city?.active && v.cover_photo_url)
    .slice(0, 5);
  const photoOf = (v: any) => v.cover_photo_url;

  const cats = [
    { title: "Things to Do", sub: "Activities, play, learn and more", href: "/browse", icon: "🔭", img: "/images/category-things-to-do.webp", grad: "linear-gradient(155deg,#F978B6,#EC1E8C)", r: "34px 34px 34px 10px" },
    { title: "Places to Go", sub: "Great days out for the whole family", href: "/browse", icon: "📍", img: "/images/category-places-to-go.webp", grad: "linear-gradient(155deg,#48BEEA,#1689BC)", r: "34px 34px 10px 34px" },
    { title: "What's On", sub: "Events, shows and activities", href: "/browse?tab=events", icon: "📅", img: "/images/category-whats-on.webp", grad: "linear-gradient(155deg,#FFC24A,#F9951B)", r: "34px 34px 34px 10px" },
    { title: "Deals", sub: "Great value days out and offers", href: "/browse?tab=deals", icon: "🏷️", img: "/images/category-deals.webp", grad: "linear-gradient(155deg,#9AD24B,#5F9A12)", r: "34px 34px 10px 34px" },
    { title: "Places to Stay", sub: "Family-friendly stays and getaways", href: "#", icon: "🛏️", img: "/images/category-places-to-stay.webp", grad: "linear-gradient(155deg,#48C9CE,#1E9AA0)", r: "34px 34px 34px 10px", soon: true },
  ];

  const badges = [
    { label: "Top pick", bg: "#EC1E8C", fg: "#fff" },
    { label: "Great for kids", bg: "#6FA713", fg: "#fff" },
    { label: "Outdoors", bg: "#1689BC", fg: "#fff" },
    { label: "Family favourite", bg: "#F9A11B", fg: "#16202A" },
    { label: "Great for kids", bg: "#6FA713", fg: "#fff" },
  ];

  const trust = [
    { ic: "⭐", t: "Handpicked family favourites" },
    { ic: "👨‍👩‍👧", t: "Real ideas from local families" },
    { ic: "📍", t: "Across Scotland" },
    { ic: "💗", t: "Free to use" },
    { ic: "🌱", t: "Support local businesses" },
  ];

  const seasonIdeas = [
    { t: "Halloween trails", s: "Spooky family fun", img: "/images/bonus-halloween.webp" },
    { t: "Autumn walks", s: "Crisp days outdoors", img: "/images/bonus-outdoor-walks.webp" },
    { t: "Cosy indoor play", s: "Rainy-day rescue", img: "/images/bonus-indoor-play.webp" },
  ];

  return (
    <div className={`${fredoka.variable} ${nunito.variable} ${caveat.variable}`} style={{ fontFamily: "var(--font-nunito)", fontWeight: 600 }}>
      {/* ---------------- HERO ---------------- */}
      <section className="container-page pt-10 sm:pt-14 pb-8">
        <div className="grid lg:grid-cols-[1.02fr_0.98fr] gap-8 lg:gap-12 items-center">
          <div>
            <p className="eyebrow mb-3">Days out · Family fun · Across Scotland</p>
            <h1 style={DISPLAY} className="text-[2.7rem] sm:text-6xl lg:text-7xl font-bold leading-[0.98] tracking-tight text-buzz-text">
              Family <span className="text-buzz-accent">adventures</span> made easy.
            </h1>
            <p className="mt-5 text-lg text-[#3c4a55] max-w-md font-semibold">
              Discover amazing things to do with the kids across Scotland — from days out and events to family-friendly places to stay, all in one place.
            </p>
            <div className="mt-6">
              <HeroSearch />
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/browse" style={DISPLAY} className="inline-flex items-center gap-2 rounded-full bg-buzz-yellow text-buzz-text font-semibold text-lg px-6 py-3.5 hover:-translate-y-0.5 transition">
                Find things to do →
              </Link>
              <Link href="/browse?tab=events" style={DISPLAY} className="inline-flex items-center gap-2 rounded-full bg-transparent text-buzz-accent2 font-semibold px-5 py-3.5 border-2 border-[#CFE7F5] hover:-translate-y-0.5 transition">
                See what&apos;s on this weekend →
              </Link>
            </div>
          </div>

          {/* Hero visual — the design photo pack (kids running) + Scottish inset */}
          <div className="relative w-full max-w-[520px] mx-auto" aria-hidden>
            <div
              className="w-full aspect-[5/4] rounded-[32px] bg-cover shadow-[0_30px_60px_-28px_rgba(22,120,190,0.55)]"
              style={{ backgroundImage: "url(/images/hero-desktop-text-safe.webp)", backgroundPosition: "72% center" }}
            />
            <div
              className="absolute right-[-3%] bottom-[-6%] w-[44%] aspect-[1.35/1] rounded-3xl border-4 border-white shadow-[0_20px_40px_-20px_rgba(0,0,0,0.4)] z-[3] bg-cover bg-center"
              style={{ backgroundImage: "url(/images/bonus-outdoor-walks.webp)" }}
            />
            <div className="absolute left-[-3%] bottom-[16%] z-[4] bg-buzz-pink text-white text-center px-4 py-4 leading-tight shadow-[0_16px_30px_-14px_rgba(236,30,140,0.7)] -rotate-6" style={{ ...DISPLAY, borderRadius: "50% 46% 52% 48%" }}>
              BIG ADVENTURES<br />for little<br />explorers
            </div>
            <div className="absolute top-[-6%] right-[2%] z-[4] text-buzz-accent2 text-center text-2xl rotate-6 leading-none" style={HAND}>
              Making<br />memories<br />across Scotland <span className="text-buzz-pink">♥</span>
            </div>
            <div className="absolute bottom-[-14%] right-[16%] z-[4] text-buzz-pink text-center text-2xl -rotate-6 leading-none" style={HAND}>
              Explore<br />discover<br />together ↘
            </div>
            <span className="absolute top-[6%] left-[20%] z-[4] text-buzz-yellow text-xl">✦</span>
            <span className="absolute top-[46%] right-[-2%] z-[4] text-buzz-pink text-xl">✦</span>
          </div>
        </div>
      </section>

      {/* ---------------- TRUST ---------------- */}
      <div className="bg-buzz-surface border-y border-buzz-border">
        <div className="container-page py-4 flex flex-wrap justify-between gap-x-5 gap-y-3">
          {trust.map((x) => (
            <div key={x.t} className="flex items-center gap-2 font-bold text-[#324049] text-sm">
              <span className="text-lg" aria-hidden>{x.ic}</span> {x.t}
            </div>
          ))}
        </div>
      </div>

      {/* ---------------- CATEGORIES ---------------- */}
      <section className="container-page py-12">
        <div className="flex items-baseline justify-between gap-4 mb-6 flex-wrap">
          <h2 style={DISPLAY} className="text-3xl sm:text-4xl font-bold text-buzz-text">
            Explore by category <span style={HAND} className="text-buzz-gold text-2xl">✦</span>
          </h2>
          <Link href="/browse" className="text-buzz-accent2 font-extrabold text-sm shrink-0 hover:underline">View all categories →</Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {cats.map((c) => (
            <Link
              key={c.title}
              href={c.href}
              className="relative overflow-hidden p-4 text-white min-h-[240px] flex flex-col hover:-translate-y-1 transition"
              style={{ background: c.grad, borderRadius: c.r }}
            >
              <div className="w-11 h-11 rounded-2xl bg-white/25 grid place-items-center text-2xl mb-2.5">{c.icon}</div>
              <h3 style={DISPLAY} className="text-xl font-bold leading-tight">{c.title}</h3>
              <p className="text-[13px] font-bold opacity-90 mt-1 mb-3">{c.sub}</p>
              {c.soon && (
                <span className="absolute top-4 right-4 rounded-full bg-white/90 text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1" style={{ color: "#1E9AA0" }}>Coming soon</span>
              )}
              <div className="mt-auto h-[92px] rounded-2xl bg-cover bg-center" style={{ backgroundImage: `url(${c.img})` }} />
            </Link>
          ))}
        </div>
      </section>

      {/* ---------------- TOP PICKS ---------------- */}
      {picks.length > 0 && (
        <section className="container-page py-6">
          <div className="flex items-baseline justify-between gap-4 mb-6 flex-wrap">
            <h2 style={DISPLAY} className="text-3xl sm:text-4xl font-bold text-buzz-text">
              Top picks this week <span style={HAND} className="text-buzz-gold text-2xl">✦</span>
            </h2>
            <Link href="/browse" className="text-buzz-accent2 font-extrabold text-sm shrink-0 hover:underline">See more family favourites →</Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {picks.map((v: any, i: number) => {
              const b = badges[i % badges.length];
              const photo = photoOf(v);
              return (
                <article key={v.id} className="bg-white border border-buzz-border rounded-3xl overflow-hidden flex flex-col hover:-translate-y-1 hover:shadow-[0_22px_40px_-26px_rgba(22,32,42,0.45)] transition">
                  <div className="relative aspect-[1.5/1] bg-buzz-surface bg-cover bg-center" style={{ backgroundImage: `url(${photo})` }}>
                    <span className="absolute top-2.5 left-2.5 text-[10px] font-extrabold uppercase tracking-wide px-2.5 py-1 rounded-full" style={{ background: b.bg, color: b.fg }}>{b.label}</span>
                    <div className="absolute top-2 right-2">
                      <FavouriteButton targetType="venue" targetId={v.id} initialFavourited={false} signedIn={!!user} size="sm" />
                    </div>
                  </div>
                  <div className="p-4 flex flex-col gap-1 flex-1">
                    <Link href={`/${v.city?.slug ?? "dundee"}/venues/${v.slug}`}>
                      <h3 style={DISPLAY} className="text-lg font-bold leading-tight text-buzz-text hover:text-buzz-accent transition">{v.name}</h3>
                    </Link>
                    <span className="text-buzz-accent2 font-extrabold text-xs">{v.city?.name}</span>
                    <p className="text-buzz-mute text-sm font-semibold flex-1 line-clamp-2">
                      {v.description || "A brilliant family day out across Scotland."}
                    </p>
                    <Link href={`/${v.city?.slug ?? "dundee"}/venues/${v.slug}`} aria-label={`View ${v.name}`} className="self-end w-8 h-8 rounded-full border border-buzz-border grid place-items-center text-buzz-accent mt-1 hover:bg-buzz-surface transition">→</Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* ---------------- SEASONAL FEATURE ---------------- */}
      <section className="container-page py-12">
        <div className="relative overflow-hidden rounded-[34px] p-6 sm:p-8 grid lg:grid-cols-[1.25fr_1fr] gap-6 items-center" style={{ background: "linear-gradient(120deg,#FDE4E0 0%,#FCEFD6 55%,#F3E9F7 100%)" }}>
          <div className="grid sm:grid-cols-2 gap-6 items-center">
            <div>
              <p className="eyebrow !text-buzz-pink mb-1">This October</p>
              <h2 style={DISPLAY} className="text-3xl sm:text-4xl font-bold text-buzz-text leading-tight">Spooky season &amp;<br />half-term fun.</h2>
              <p className="mt-3 text-[#4a5560] max-w-md font-semibold">From Halloween trails to October-week holiday clubs, find the best family days out across Scotland this month.</p>
              <Link href="/browse?tab=events" style={DISPLAY} className="inline-flex items-center gap-2 mt-5 rounded-full bg-buzz-text text-white font-semibold px-6 py-3.5 hover:-translate-y-0.5 transition">Explore October ideas →</Link>
            </div>
            <div className="relative rounded-3xl min-h-[190px] bg-cover bg-center overflow-hidden" style={{ backgroundImage: "url(/images/bonus-halloween.webp)" }}>
              <div className="absolute top-3 right-3 bg-buzz-pink text-white text-center text-[13px] px-3.5 py-3 leading-tight rotate-6" style={{ ...DISPLAY, borderRadius: "50% 46% 52% 48%" }}>FAMILY FUN<br />THIS MONTH</div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-2.5 shadow-[0_18px_40px_-24px_rgba(22,32,42,0.35)]">
            {seasonIdeas.map((s) => (
              <Link key={s.t} href="/browse?tab=events" className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-buzz-surface transition">
                <span className="w-12 h-12 rounded-xl bg-cover bg-center shrink-0" style={{ backgroundImage: `url(${s.img})` }} />
                <span className="min-w-0 flex-1">
                  <span style={DISPLAY} className="block font-bold text-buzz-text leading-tight">{s.t}</span>
                  <small className="text-buzz-mute font-bold">{s.s}</small>
                </span>
                <span className="text-buzz-accent">→</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- DUAL CTA ---------------- */}
      <section className="container-page pb-12">
        <div className="grid lg:grid-cols-2 gap-5">
          <div className="rounded-[26px] p-7" style={{ background: "linear-gradient(135deg,#FDE4F1,#FCD9E9)" }}>
            <p className="eyebrow !text-buzz-pink">For parents and carers</p>
            <h2 style={DISPLAY} className="text-2xl font-bold text-buzz-text mt-1">Get ideas, straight to your inbox.</h2>
            <p className="mt-2 text-[#49555f] font-semibold max-w-md">Be the first to know about the latest events, days out, special offers and seasonal inspiration. Free, no spam, just family fun!</p>
            <NewsletterInline />
          </div>
          <div className="relative overflow-hidden rounded-[26px] p-7" style={{ background: "linear-gradient(135deg,#E3F3FC,#D4ECF8)" }}>
            <p className="eyebrow">For clubs, venues &amp; activity providers</p>
            <h2 style={DISPLAY} className="text-2xl font-bold text-buzz-text mt-1">List your activities. For free.</h2>
            <p className="mt-2 text-[#49555f] font-semibold max-w-md">Reach local families looking for great things to do. It&apos;s quick, easy and completely free to list your club, event or venue on The Buzz Kids.</p>
            <Link href="/list-your-activity" style={DISPLAY} className="inline-flex items-center gap-2 mt-4 rounded-full bg-buzz-accent text-white font-semibold px-6 py-3.5 hover:-translate-y-0.5 transition">List an activity for free →</Link>
            <span className="absolute right-5 bottom-4 text-5xl opacity-90" aria-hidden>📣</span>
          </div>
        </div>
      </section>

      {/* ---------------- PRE-FOOTER HILLS ---------------- */}
      <div className="relative">
        <div className="container-page flex justify-end pr-6">
          <span style={HAND} className="text-buzz-accent text-2xl text-right leading-none -rotate-3">Happier family<br />days in Scotland</span>
        </div>
        <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className="w-full h-16 sm:h-20 -mt-2" aria-hidden>
          <circle cx="1030" cy="40" r="16" fill="#FFD23F" />
          <path d="M0 120 Q200 60 440 80 T860 70 T1200 92 V120 Z" fill="#8CC63F" />
          <path d="M0 120 Q320 78 640 96 T1200 100 V120 Z" fill="#6FA713" />
          <rect x="560" y="56" width="20" height="28" fill="#9FB0BC" />
          <rect x="565" y="46" width="10" height="12" fill="#9FB0BC" />
        </svg>
      </div>
    </div>
  );
}
