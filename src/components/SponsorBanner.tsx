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
      <p className="eyebrow text-[10px] text-buzz-accent mb-2.5">Sponsored</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 items-stretch">
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
                className="group flex flex-col h-full rounded-2xl border-2 border-dashed border-buzz-accent/40 bg-gradient-to-br from-buzz-accent/10 to-buzz-accent/[0.03] hover:border-buzz-accent hover:shadow-lg hover:shadow-buzz-accent/10 transition-all overflow-hidden"
              >
                <div className="h-24 grid place-items-center">
                  <div className="w-12 h-12 rounded-full bg-buzz-accent/15 grid place-items-center text-2xl">📣</div>
                </div>
                <div className="px-3.5 pb-3.5 flex flex-col gap-1 flex-1">
                  <p className="font-display text-sm uppercase leading-tight text-buzz-accent">{s.name}</p>
                  {s.blurb && <p className="text-[11px] text-buzz-mute line-clamp-2 leading-snug">{s.blurb}</p>}
                  <p className="mt-auto pt-1.5 text-[11px] font-bold uppercase tracking-wider text-buzz-accent inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                    Get prices <span aria-hidden>→</span>
                  </p>
                </div>
              </a>
            );
          }
          // The logo already carries the brand name, so only show a caption
          // (the blurb) below — avoids the "logo + NAME repeated" redundancy.
          // Falls back to the name only when there's no blurb / no logo.
          const caption = s.blurb ?? (s.image_url ? s.name : null);
          return (
            <a
              key={s.id}
              href={`/api/sponsor-click/${s.id}`}
              target="_blank"
              rel="noopener sponsored"
              className="group flex flex-col h-full rounded-2xl border border-buzz-border bg-buzz-card hover:border-buzz-accent hover:shadow-lg hover:-translate-y-0.5 transition-all overflow-hidden"
            >
              {/* Dark logo tile — keeps white / pale wordmarks visible. Padding
                  keeps the logo off the edges so nothing gets clipped. */}
              <div className="h-24 bg-gradient-to-br from-slate-800 to-slate-950 ring-1 ring-inset ring-white/5 grid place-items-center overflow-hidden p-4">
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
                  <span className="text-white font-display text-sm uppercase text-center leading-tight line-clamp-2">{s.name}</span>
                )}
              </div>
              <div className="px-3.5 py-2.5 flex-1 flex items-start">
                {caption && <p className="text-[11px] text-buzz-mute line-clamp-2 leading-snug">{caption}</p>}
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}
