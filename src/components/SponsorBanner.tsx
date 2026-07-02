// Compact sponsor strip. Shows up to N currently-live Popular + Premium
// sponsors (premium weighted heavier) as small cards in a row, rather than one
// big banner. Logos sit on a dark tile so pale/white wordmarks stay visible on
// the bright site. Each card links via /api/sponsor-click/[id] so clicks are
// tracked; impressions are bumped for every card shown.
//
// Server component — cheap, SEO-friendly, no client JS.

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
  hideIfEmpty = true,
  limit = 4,
}: {
  citySlug?: string;
  hideIfEmpty?: boolean;
  limit?: number;
}) {
  const sb = createServiceClient();
  const nowIso = new Date().toISOString();

  let cityId: string | null = null;
  if (citySlug) {
    const { data: city } = await sb.from("cities").select("id").eq("slug", citySlug).maybeSingle();
    cityId = city?.id ?? null;
  }

  let query = sb
    .from("sponsors")
    .select("id, slug, name, tier, image_url, link_url, blurb, city_id")
    .eq("status", "active")
    .lte("starts_at", nowIso)
    .gte("ends_at", nowIso)
    .in("tier", ["popular", "premium"]);

  // City pages: this area's ads + nationwide. Homepage: everything live.
  if (cityId) query = query.or(`city_id.eq.${cityId},city_id.is.null`);

  const { data: sponsors } = await query;
  const pool = (sponsors ?? []) as Sponsor[];
  if (pool.length === 0) {
    return hideIfEmpty ? null : (
      <div className="container-page py-6">
        <div className="card p-6 text-buzz-mute text-sm">No sponsors live right now.</div>
      </div>
    );
  }

  // Premium counts twice, then shuffle and take up to `limit` distinct.
  const weighted = pool.flatMap((s) => (s.tier === "premium" ? [s, s] : [s]));
  for (let i = weighted.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [weighted[i], weighted[j]] = [weighted[j], weighted[i]];
  }
  const picked: Sponsor[] = [];
  const seen = new Set<string>();
  for (const s of weighted) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    picked.push(s);
    if (picked.length >= limit) break;
  }

  // Bump an impression for each card we're about to render.
  await Promise.all(picked.map((s) => sb.rpc("increment_sponsor_impression", { sponsor_id: s.id })));

  return (
    <section className="container-page py-6">
      <p className="eyebrow text-[10px] text-buzz-accent mb-2">Sponsored</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {picked.map((s) => {
          // "House ad" — a sponsor that promotes the ad space itself (links to
          // our /advertise page). Rendered as an accent CTA instead of a brand
          // logo card so it reads as an invitation, not a fake sponsor. Manage
          // it like any sponsor in /admin/sponsors (pause to hide it).
          const isHouse = (s.link_url || "").includes("/advertise");
          if (isHouse) {
            return (
              <a
                key={s.id}
                href={`/api/sponsor-click/${s.id}`}
                target="_blank"
                rel="noopener"
                className="group flex flex-col rounded-xl bg-buzz-accent text-white shadow-md hover:shadow-lg hover:bg-buzz-accent2 transition overflow-hidden"
              >
                <div className="h-20 grid place-items-center text-3xl">📣</div>
                <div className="p-2.5 min-w-0">
                  <p className="font-display text-sm uppercase leading-tight truncate">{s.name}</p>
                  {s.blurb && <p className="text-[11px] text-white/85 line-clamp-2 leading-snug mt-0.5">{s.blurb}</p>}
                  <p className="text-[10px] font-bold uppercase tracking-wider mt-1 inline-flex items-center gap-1 group-hover:gap-2 transition-all">Get prices →</p>
                </div>
              </a>
            );
          }
          return (
          <a
            key={s.id}
            href={`/api/sponsor-click/${s.id}`}
            target="_blank"
            rel="noopener sponsored"
            className="group flex flex-col rounded-xl border border-buzz-border bg-buzz-card hover:border-buzz-accent hover:shadow-sm transition overflow-hidden"
          >
            {/* Dark logo tile — keeps white / pale wordmarks visible. Padding
                keeps the logo off the edges so nothing gets clipped. */}
            <div className="h-20 bg-gradient-to-br from-slate-700 to-slate-900 grid place-items-center overflow-hidden p-3">
              {s.image_url ? (
                <div
                  className="w-full h-full"
                  style={{
                    backgroundImage: `url(${s.image_url})`,
                    backgroundSize: "contain",
                    backgroundPosition: "center",
                    backgroundRepeat: "no-repeat",
                  }}
                />
              ) : (
                <span className="text-white font-bold text-xs text-center px-2 leading-tight line-clamp-2">{s.name}</span>
              )}
            </div>
            <div className="p-2.5 min-w-0">
              <p className="font-display text-sm uppercase leading-tight truncate group-hover:text-buzz-accent transition">
                {s.name}
              </p>
              {s.blurb && <p className="text-[11px] text-buzz-mute line-clamp-2 leading-snug mt-0.5">{s.blurb}</p>}
            </div>
          </a>
          );
        })}
      </div>
    </section>
  );
}
