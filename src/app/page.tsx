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

  // Top-rated real places — genuine photography + Google ratings.
  const { data: topRated } = await supabase
    .from("venues")
    .select("id, name, slug, description, cover_photo_url, image_url, google_photo_url, google_rating, google_rating_count, city:cities(name, slug, active)")
    .eq("approved", true)
    .in("venue_type", ["attraction", "both"])
    .not("google_rating", "is", null)
    .gte("google_rating_count", 100)
    .order("google_rating", { ascending: false })
    .order("google_rating_count", { ascending: false })
    .limit(16);

  const favourites = (topRated ?? []).filter((v: any) => v.city?.active);
  const photoOf = (v: any) => v?.cover_photo_url || v?.image_url || v?.google_photo_url || null;
  const heroA = favourites.find((v: any) => photoOf(v)) ?? favourites[0];
  const heroB = favourites.filter((v: any) => v.id !== heroA?.id).find((v: any) => photoOf(v)) ?? favourites[1];
  const picks = favourites.filter((v: any) => v.id !== heroA?.id).slice(0, 5);

  const cats = [
    { title: "Things to Do", sub: "Activities, play, learn and more", href: "/browse", icon: "🔭", grad: "linear-gradient(155deg,#F978B6,#EC1E8C)", r: "34px 34px 34px 10px" },
    { title: "Places to Go", sub: "Great days out for the whole family", href: "/browse", icon: "📍", grad: "linear-gradient(155deg,#48BEEA,#1689BC)", r: "34px 34px 10px 34px" },
    { title: "What's On", sub: "Events, shows and activities", href: "/browse?tab=events", icon: "📅", grad: "linear-gradient(155deg,#FFC24A,#F9951B)", r: "34px 34px 34px 10px" },
    { title: "Deals", sub: "Great value days out and offers", href: "/browse?tab=deals", icon: "🏷️", grad: "linear-gradient(155deg,#9AD24B,#5F9A12)", r: "34px 34px 10px 34px" },
    { title: "Places to Stay", sub: "Family-friendly stays and getaways", href: "#", icon: "🛏️", grad: "linear-gradient(155deg,#48C9CE,#1E9AA0)", r: "34px 34px 34px 10px", soon: true },
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

  return (
    <div className={`${fredoka.variable} ${nunito.variable} ${caveat.variable}`} style={{ fontFamily: "var(--font-nunito)", fontWeight: 600 }}>
      {/* ---------------- HERO ---------------- */}
      <section className="container-page pt-10 sm:pt-14 pb-8">
        <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-8 lg:gap-12 items-center">
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

          {/* Hero visual — built from real top-rated place photography */}
          <div className="relative w-full max-w-[460px] mx-auto aspect-square" aria-hidden>
            <div
              className="absolute inset-0 right-[6%] bottom-[8%] rounded-[36px_40px_44px_36px] bg-buzz-surface shadow-[0_30px_60px_-28px_rgba(22,120,190,0.6)] bg-cover bg-center"
              style={photoOf(heroA) ? { backgroundImage: `url(${photoOf(heroA)})` } : { background: "linear-gradient(160deg,#9FD6F4,#2E8FD0)" }}
            />
            <div
              className="absolute right-[-2%] bottom-[2%] w-[46%] aspect-[1.3/1] rounded-3xl border-4 border-white shadow-[0_20px_40px_-20px_rgba(0,0,0,0.4)] z-[3] bg-cover bg-center"
              style={photoOf(heroB) ? { backgroundImage: `url(${photoOf(heroB)})` } : { background: "linear-gradient(160deg,#9AD6B0,#2E7D6B)" }}
            />
            <div className="absolute left-[-3%] bottom-[14%] z-[4] bg-buzz-pink text-white text-center px-4 py-4 leading-tight shadow-[0_16px_30px_-14px_rgba(236,30,140,0.7)] -rotate-6" style={{ ...DISPLAY, borderRadius: "50% 46% 52% 48%" }}>
              BIG ADVENTURES<br />for little<br />explorers
            </div>
            <div className="absolute top-[-4%] right-[4%] z-[4] text-buzz-accent2 text-center text-2xl rotate-6 leading-none" style={HAND}>
              Making<br />memories<br />across Scotland <span className="text-buzz-pink">♥</span>
            </div>
            <div className="absolute bottom-[-5%] right-[14%] z-[4] text-buzz-pink text-center text-2xl -rotate-6 leading-none" style={HAND}>
              Explore<br />discover<br />together ↘
            </div>
            <span className="absolute top-[8%] left-[34%] z-[4] text-buzz-yellow text-xl">✦</span>
            <span className="absolute top-[42%] right-[1%] z-[4] text-buzz-pink text-xl">✦</span>
            <span className="absolute bottom-[30%] left-[8%] z-[4] text-buzz-lime text-xl">✦</span>
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
              className="relative overflow-hidden p-5 text-white min-h-[210px] flex flex-col hover:-translate-y-1 transition"
              style={{ background: c.grad, borderRadius: c.r }}
            >
              <div className="w-12 h-12 rounded-2xl bg-white/25 grid place-items-center text-2xl mb-3">{c.icon}</div>
              <h3 style={DISPLAY} className="text-xl font-bold leading-tight">{c.title}</h3>
              <p className="text-[13px] font-bold opacity-90 mt-1">{c.sub}</p>
              {c.soon && (
                <span className="absolute top-4 right-4 rounded-full bg-white/90 text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1" style={{ color: "#1E9AA0" }}>Coming soon</span>
              )}
              <span className="mt-auto text-2xl opacity-90">{c.icon}</span>
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
                  <div
                    className="relative aspect-[1.5/1] bg-buzz-surface bg-cover bg-center"
                    style={photo ? { backgroundImage: `url(${photo})` } : undefined}
                  >
                    {!photo && <div className="absolute inset-0 grid place-items-center text-4xl opacity-50">🐝</div>}
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
        <div className="relative overflow-hidden rounded-[34px] p-7 sm:p-9 grid lg:grid-cols-[1.1fr_1fr] gap-7 items-center" style={{ background: "linear-gradient(120deg,#FDE4E0 0%,#FCEFD6 55%,#F3E9F7 100%)" }}>
          <div>
            <p className="eyebrow !text-buzz-pink mb-1">This October</p>
            <h2 style={DISPLAY} className="text-3xl sm:text-4xl font-bold text-buzz-text leading-tight">Spooky season &amp;<br />half-term fun.</h2>
            <p className="mt-3 text-[#4a5560] max-w-md font-semibold">From Halloween trails and pumpkin patches to October-week holiday clubs, find the best family-friendly things to do across Scotland this month.</p>
            <Link href="/browse?tab=events" style={DISPLAY} className="inline-flex items-center gap-2 mt-5 rounded-full bg-buzz-text text-white font-semibold px-6 py-3.5 hover:-translate-y-0.5 transition">Explore October ideas →</Link>
          </div>
          <div className="relative rounded-3xl min-h-[200px] grid place-items-center text-6xl overflow-hidden" style={{ background: "linear-gradient(155deg,#FFC98A,#F79A3B 55%,#C9699B)" }}>
            <span>🎃</span>
            <div className="absolute top-3 right-3 bg-buzz-pink text-white text-center text-[13px] px-3.5 py-3 leading-tight rotate-6" style={{ ...DISPLAY, borderRadius: "50% 46% 52% 48%" }}>FAMILY FUN<br />THIS MONTH</div>
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
