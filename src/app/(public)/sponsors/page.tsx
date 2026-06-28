// Public sponsor directory. Lists every currently-live sponsor (all tiers).
// Premium tier specifically pays for prominence on this page; we sort by
// tier so premium > popular > starter.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Local businesses & advertisers — The Buzz Guide",
  description:
    "Local businesses that support The Buzz Guide. Takeaways, taxis, services — discover what's in your area.",
};

const TIER_ORDER: Record<string, number> = { premium: 0, popular: 1, starter: 2 };

export default async function SponsorsDirectoryPage() {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const { data: sponsors } = await supabase
    .from("sponsors")
    .select("id, name, slug, tier, image_url, blurb, category, city:cities(name, slug)")
    .eq("status", "active")
    .lte("starts_at", nowIso)
    .gte("ends_at", nowIso);

  const list = (sponsors ?? []).slice().sort((a: any, b: any) => {
    const ta = TIER_ORDER[a.tier] ?? 9;
    const tb = TIER_ORDER[b.tier] ?? 9;
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="container-page py-10 sm:py-14 max-w-6xl">
      <p className="eyebrow mb-2">Backed by the locals</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-3">Local businesses on The Buzz Guide</h1>
      <p className="text-buzz-mute mb-10 max-w-2xl">
        The takeaways, taxis, and local businesses that keep The Buzz Guide running.
        If you're heading out tonight, give them a shout — they support what we do.
      </p>

      {/* Always render at least 2 cards (sponsors + a "Become a sponsor" CTA)
          so the grid never looks empty with a single advertiser. 2 columns
          on desktop means even 1 sponsor + the CTA fills the row. */}
      <div className="grid sm:grid-cols-2 gap-5">
        {list.map((s: any) => (
          <SponsorBigCard key={s.id} sponsor={s} />
        ))}
        <BecomeASponsorCard />
      </div>

      <p className="text-xs text-buzz-mute mt-10 max-w-2xl">
        Sponsorships keep listings free for venues, artists and event organisers.
        Want to put your business in front of locals heading out tonight?{" "}
        <Link href="/advertise" className="text-buzz-accent hover:underline">
          See our packages →
        </Link>
      </p>
    </div>
  );
}

function SponsorBigCard({ sponsor }: { sponsor: any }) {
  // The logo is almost always a wordmark with the business name baked in,
  // so re-stating the name in a giant heading below it reads as duplicate.
  // We keep the name only for screen readers (aria-label) and only show
  // the city in the meta line when it's NOT already part of the name —
  // that way "Dundee Scoff" doesn't end up saying "Dundee" three times.
  const cityName: string | null = sponsor.city?.name ?? null;
  const nameLower = (sponsor.name ?? "").toLowerCase();
  const cityAlreadyInName = cityName && nameLower.includes(cityName.toLowerCase());
  const showCityInMeta = cityName && !cityAlreadyInName;

  return (
    <Link
      href={`/sponsors/${sponsor.slug}`}
      aria-label={`Visit ${sponsor.name} sponsor page`}
      className="card-hover p-6 sm:p-8 flex flex-col gap-5 lift h-full group"
    >
      {/* Logo — no black box, no border. Sits directly on the card's
          surface (same trick as the homepage banner). Bigger height so it
          actually feels like a feature. */}
      <div className="flex items-center justify-center min-h-[120px]">
        {sponsor.image_url ? (
          <div
            className="w-full max-w-[260px] h-24 sm:h-28"
            style={{
              backgroundImage: `url(${sponsor.image_url})`,
              backgroundSize: "contain",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
            }}
          />
        ) : (
          // Symbol-only logo fallback — we keep the heading below in this
          // case so users know whose card this is.
          <div className="font-display text-2xl sm:text-3xl uppercase text-center">
            {sponsor.name}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1 min-w-0">
        <p className="eyebrow text-[10px] text-buzz-accent">Sponsored</p>
        {sponsor.blurb && (
          <p className="text-buzz-mute italic text-lg leading-snug">
            "{sponsor.blurb}"
          </p>
        )}
        {(showCityInMeta || sponsor.category) && (
          <div className="text-[10px] text-buzz-mute uppercase tracking-wider mt-2">
            {[showCityInMeta ? cityName : null, sponsor.category]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}
      </div>

      <div className="mt-auto pt-2">
        <span className="text-sm font-bold text-buzz-accent group-hover:translate-x-1 inline-block transition">
          Visit page →
        </span>
      </div>
    </Link>
  );
}

function BecomeASponsorCard() {
  return (
    <Link
      href="/advertise"
      className="card-hover p-6 sm:p-8 flex flex-col gap-5 lift h-full group border-dashed border-buzz-accent/40"
    >
      <div className="flex items-center justify-center min-h-[120px]">
        <div className="text-5xl sm:text-6xl">🐝</div>
      </div>

      <div className="flex flex-col gap-1 min-w-0">
        <p className="eyebrow text-[10px] text-buzz-accent">Your business here</p>
        <h2 className="font-display text-2xl sm:text-3xl uppercase leading-tight group-hover:text-buzz-accent transition">
          Advertise with The Buzz Guide
        </h2>
        <p className="text-buzz-mute mt-1">
          Reach locals heading out tonight. Three packages from £30/month —
          rotating placements on the homepage, in the app, and on our socials.
        </p>
      </div>

      <div className="mt-auto pt-2">
        <span className="text-sm font-bold text-buzz-accent group-hover:translate-x-1 inline-block transition">
          See packages →
        </span>
      </div>
    </Link>
  );
}
