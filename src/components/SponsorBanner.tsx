// Homepage sponsor banner. Rotates through currently-live Popular + Premium
// sponsors targeted at the visitor (or nationwide ones). Pick one at random
// per request and bump its impression counter.
//
// Why server-rendered: cheap, SEO-friendly, no client JS bundle cost. The
// click tracker is a separate /api/sponsor-click/[id] redirect so we capture
// real clicks without needing JS either.

import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";

type Sponsor = {
  id: string;
  slug: string;
  name: string;
  tier: "starter" | "popular" | "premium";
  image_url: string | null;
  link_url: string;
  blurb: string | null;
};

export default async function SponsorBanner({
  citySlug,
  // When true, we'll skip rendering anything if no eligible sponsor is found
  // (so callers can place it inside a section without an empty card).
  hideIfEmpty = true,
}: {
  citySlug?: string;
  hideIfEmpty?: boolean;
}) {
  const sb = createServiceClient();
  const nowIso = new Date().toISOString();

  // Resolve city ID once if we got a slug.
  let cityId: string | null = null;
  if (citySlug) {
    const { data: city } = await sb
      .from("cities")
      .select("id")
      .eq("slug", citySlug)
      .maybeSingle();
    cityId = city?.id ?? null;
  }

  // Eligible = currently live, tier ∈ {popular, premium}.
  //   - When called with a citySlug (city page): match that city OR nationwide
  //   - When called without (homepage): match anything live — the homepage
  //     covers every city so ads targeted at any city are valid
  let query = sb
    .from("sponsors")
    .select("id, slug, name, tier, image_url, link_url, blurb, city_id")
    .eq("status", "active")
    .lte("starts_at", nowIso)
    .gte("ends_at", nowIso)
    .in("tier", ["popular", "premium"]);

  if (cityId) {
    query = query.or(`city_id.eq.${cityId},city_id.is.null`);
  }
  // No `else` — homepage shows ads from every city.

  const { data: sponsors } = await query;
  const pool = (sponsors ?? []) as Sponsor[];
  if (pool.length === 0) {
    return hideIfEmpty ? null : (
      <div className="container-page py-6"><div className="card p-6 text-buzz-mute text-sm">No sponsors live right now.</div></div>
    );
  }

  // Premium > popular weighting (premium pays more, gets more eyeballs).
  // Each premium entry counted twice in the pool before random selection.
  const weighted = pool.flatMap((s) => (s.tier === "premium" ? [s, s] : [s]));
  const picked = weighted[Math.floor(Math.random() * weighted.length)];

  // Bump impression count. Awaited because dangling promises in a React
  // Server Component can be cancelled when the response is streamed — the
  // call is a tiny SQL UPDATE (~10ms) so blocking the render briefly is
  // a fair trade for guaranteed accuracy.
  await sb.rpc("increment_sponsor_impression", { sponsor_id: picked.id });

  return <SponsorBannerLayout sponsor={picked} />;
}

function SponsorBannerLayout({ sponsor }: { sponsor: Sponsor }) {
  return (
    <section className="container-page py-6">
      <a
        // Route via our tracker so we capture the click before redirecting
        // out to the advertiser's site.
        href={`/api/sponsor-click/${sponsor.id}`}
        target="_blank"
        rel="noopener sponsored"
        className="block group relative overflow-hidden rounded-2xl border border-buzz-accent/30 bg-gradient-to-r from-buzz-accent/5 via-buzz-card to-buzz-accent/5 hover:border-buzz-accent hover:shadow-md transition"
      >
        <div className="flex items-center gap-4 sm:gap-5 p-4 sm:p-5">
          {/* Logo — no container box / border. We rely on the logo's own
              padding + the banner's dark gradient to frame it. Looks far
              cleaner than the previous black box, and works for both
              transparent logos and logos with their own dark backgrounds
              (which blend invisibly into the banner). */}
          <div className="shrink-0">
            {sponsor.image_url ? (
              <div
                className="w-20 h-14 sm:w-32 sm:h-20"
                style={{
                  backgroundImage: `url(${sponsor.image_url})`,
                  backgroundSize: "contain",
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                }}
              />
            ) : (
              <div className="w-20 h-14 sm:w-32 sm:h-20 grid place-items-center text-base sm:text-lg font-bold text-buzz-accent">
                {sponsor.name}
              </div>
            )}
          </div>

          {/* Text block — three rows of hierarchy:
              1. "SPONSORED" eyebrow (FTC-style ad disclosure, always present)
              2. Business name on its own line so wordmark logos that are
                 hard to read at small sizes are reinforced in plain text
              3. Slogan/blurb in a softer style, wraps to 2 lines on mobile */}
          <div className="min-w-0 flex-1">
            <p className="eyebrow text-[10px] text-buzz-accent">Sponsored</p>
            <p className="h-display text-lg sm:text-2xl leading-snug mt-0.5 group-hover:text-buzz-accent transition truncate">
              {sponsor.name}
            </p>
            {sponsor.blurb && (
              <p className="text-xs sm:text-sm text-buzz-mute italic line-clamp-2 leading-snug mt-1">
                {sponsor.blurb}
              </p>
            )}
          </div>

          {/* Arrow */}
          <div className="hidden sm:flex items-center text-buzz-accent text-2xl pr-2 shrink-0 group-hover:translate-x-1 transition">
            →
          </div>
        </div>
      </a>
    </section>
  );
}
