// Homepage banner that surfaces an active or upcoming festival we're sponsoring.
// Auto-hides once the festival is over. Falls back to nothing if none published.
//
// Server component — runs the DB query, picks the soonest upcoming festival,
// and renders the branded callout. The styling pulls from the festival's own
// `primary_color` so each festival reads as its own brand.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatFestivalDateRange } from "@/lib/utils";

// Render up to this many festival banners stacked on the homepage. Anything
// more would push the rest of the page (Tonight in Dundee, etc.) too far
// down the fold. Soonest-starting festivals come first; the rest are reached
// via the "See all festivals" link below the stack.
const MAX_BANNERS = 2;

export default async function SponsoredFestivalBanner() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  // All upcoming/active published festivals, soonest first. Each one drops
  // off the banner automatically once its end_date passes.
  const { data: festivals } = await supabase
    .from("festivals")
    .select("name, slug, start_date, end_date, primary_color, tagline, hero_image_url")
    .eq("published", true)
    .gte("end_date", today)
    .order("start_date", { ascending: true })
    .limit(MAX_BANNERS);

  if (!festivals || festivals.length === 0) return null;

  // Total count (incl. any beyond the cap) so we know whether to surface
  // the "See all festivals" link below the stack. Cheap counting query —
  // no row data fetched.
  const { count: totalUpcoming } = await supabase
    .from("festivals")
    .select("id", { count: "exact", head: true })
    .eq("published", true)
    .gte("end_date", today);

  const today_t = new Date(today + "T00:00:00").getTime();

  return (
    <section className="container-page pt-8 sm:pt-10 flex flex-col gap-4">
      {festivals.map((festival) => {
        const accent = festival.primary_color || "#e91e63";
        const start_t = new Date(festival.start_date + "T00:00:00").getTime();
        const end_t = new Date(festival.end_date + "T23:59:59").getTime();
        const isLive = today_t >= start_t && today_t <= end_t;
        const daysAway = Math.max(0, Math.ceil((start_t - today_t) / (1000 * 60 * 60 * 24)));
        const dateLabel = formatFestivalDateRange(festival.start_date, festival.end_date);

        return (
          <Link
            key={festival.slug}
            href={`/festivals/${festival.slug}`}
            className="group block relative overflow-hidden rounded-3xl border transition hover:scale-[1.005]"
            style={{
              background: festival.hero_image_url
                ? `linear-gradient(135deg, ${accent}ee 0%, ${shade(accent, -25)}ee 100%), url(${festival.hero_image_url}) center/cover`
                : `linear-gradient(135deg, ${accent} 0%, ${shade(accent, -25)} 100%)`,
              borderColor: `${accent}66`,
            }}
          >
            {/* Decorative grain */}
            <div
              aria-hidden
              className="absolute inset-0 opacity-30 mix-blend-overlay pointer-events-none"
              style={{
                backgroundImage:
                  "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"80\" height=\"80\"><circle cx=\"40\" cy=\"40\" r=\"1.5\" fill=\"%23ffffff20\"/></svg>')",
              }}
            />

            <div className="relative px-6 py-8 sm:px-10 sm:py-10 flex flex-col sm:flex-row items-start sm:items-center gap-6 text-white">
              <div className="flex-1 min-w-0">
                <div className="inline-flex items-center gap-2 bg-black/30 backdrop-blur px-3 py-1 rounded-full text-[10px] uppercase tracking-[0.2em] font-bold mb-3">
                  <span>🐝</span>
                  <span>The Buzz Guide · Featured festival</span>
                </div>
                <h2 className="font-display text-3xl sm:text-4xl uppercase leading-[0.95]" style={{ textShadow: "2px 2px 0 rgba(0,0,0,0.3)" }}>
                  {festival.name}
                </h2>
                {festival.tagline && (
                  <p className="text-sm sm:text-base mt-2 font-medium opacity-95">{festival.tagline}</p>
                )}
                <div className="text-xs sm:text-sm mt-3 font-bold uppercase tracking-wider opacity-90">
                  {dateLabel}
                  {!isLive && daysAway > 0 && (
                    <span className="ml-2 inline-flex items-center bg-black/30 backdrop-blur px-2 py-0.5 rounded text-[10px]">
                      {daysAway} day{daysAway === 1 ? "" : "s"} away
                    </span>
                  )}
                  {isLive && (
                    <span className="ml-2 inline-flex items-center bg-emerald-500/90 px-2 py-0.5 rounded text-[10px] animate-pulse">
                      ● LIVE NOW
                    </span>
                  )}
                </div>
              </div>

              <div className="shrink-0 inline-flex items-center gap-2 bg-black/40 hover:bg-black/60 backdrop-blur px-5 py-3 rounded-lg font-bold text-sm uppercase tracking-wider transition group-hover:translate-x-1">
                See lineup &amp; map →
              </div>
            </div>
          </Link>
        );
      })}

      {/* "See all festivals" link sits below the stack. Always shown when
          at least one festival is upcoming, so visitors can discover past
          festivals + future ones beyond the homepage cap. */}
      <div className="flex justify-end">
        <Link
          href="/festivals"
          className="text-sm text-buzz-mute hover:text-buzz-accent transition inline-flex items-center gap-1"
        >
          {(totalUpcoming ?? festivals.length) > festivals.length
            ? `See all ${totalUpcoming} festivals →`
            : "See all festivals →"}
        </Link>
      </div>
    </section>
  );
}

function shade(hex: string, percent: number): string {
  let c = hex.replace("#", "");
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  const num = parseInt(c, 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + Math.round(2.55 * percent)));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + Math.round(2.55 * percent)));
  const b = Math.max(0, Math.min(255, (num & 0xff) + Math.round(2.55 * percent)));
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

// Shared festival-range formatter lives in @/lib/utils — includes
// ordinal suffixes (30 → 30th) that this local copy was missing.
