// All festivals listing page. Grouped into Live now / Coming up / Past so
// visitors landing here from the homepage "See all festivals" link can
// quickly find what's on now, what to plan for, and what they missed.
//
// Server component — pulls a single query for all published festivals
// then partitions in JS. Past festivals are intentionally included for
// discovery + SEO; capped at the most recent so the page doesn't grow
// unbounded as the years go by.

import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { formatFestivalDateRange } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Festivals in Scotland — The Buzz Kids",
  description:
    "Every festival we cover — live now, coming up, and recent past. Lineups, stage times, maps and tickets for music festivals across Scotland.",
};

const PAST_LIMIT = 12;

type FestivalCard = {
  id: string;
  name: string;
  slug: string;
  start_date: string;
  end_date: string;
  tagline: string | null;
  primary_color: string | null;
  hero_image_url: string | null;
};

export default async function FestivalsIndexPage() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: festivals } = await supabase
    .from("festivals")
    .select("id, name, slug, start_date, end_date, tagline, primary_color, hero_image_url")
    .eq("published", true)
    .order("start_date", { ascending: false });

  const all = (festivals ?? []) as FestivalCard[];
  const live: FestivalCard[] = [];
  const upcoming: FestivalCard[] = [];
  const past: FestivalCard[] = [];

  for (const f of all) {
    if (f.end_date < today) {
      past.push(f);
    } else if (f.start_date <= today) {
      live.push(f);
    } else {
      upcoming.push(f);
    }
  }
  // Upcoming should read soonest-first (the main query is desc for past).
  upcoming.sort((a, b) => a.start_date.localeCompare(b.start_date));

  const pastShown = past.slice(0, PAST_LIMIT);

  return (
    <div className="container-page py-10 sm:py-14">
      <p className="eyebrow mb-2">Festivals</p>
      <h1 className="h-display text-5xl sm:text-6xl mb-4">All Festivals</h1>
      <p className="text-buzz-mute max-w-2xl mb-10">
        Every festival we cover across Scotland — lineups, set times, stage maps and tickets in one place.
      </p>

      {live.length > 0 && (
        <FestivalSection title="Live now" festivals={live} liveBadge />
      )}

      {upcoming.length > 0 && (
        <FestivalSection title="Coming up" festivals={upcoming} />
      )}

      {pastShown.length > 0 && (
        <FestivalSection title="Past festivals" festivals={pastShown} muted />
      )}

      {all.length === 0 && (
        <div className="card p-10 text-center">
          <div className="text-5xl mb-3">🎪</div>
          <p className="text-buzz-mute">
            No festivals listed yet. Check back soon — Scotland's gearing up for a busy summer.
          </p>
        </div>
      )}
    </div>
  );
}

function FestivalSection({
  title,
  festivals,
  liveBadge,
  muted,
}: {
  title: string;
  festivals: FestivalCard[];
  liveBadge?: boolean;
  muted?: boolean;
}) {
  return (
    <section className="mb-12">
      <h2 className="font-display text-2xl sm:text-3xl uppercase mb-5 text-buzz-text">
        {title}
      </h2>
      <div className={`grid sm:grid-cols-2 lg:grid-cols-3 gap-4 ${muted ? "opacity-90" : ""}`}>
        {festivals.map((f) => (
          <FestivalCardLink key={f.id} festival={f} liveBadge={liveBadge} />
        ))}
      </div>
    </section>
  );
}

function FestivalCardLink({
  festival,
  liveBadge,
}: {
  festival: FestivalCard;
  liveBadge?: boolean;
}) {
  const accent = festival.primary_color || "#fdb913";
  const dateLabel = formatFestivalDateRange(festival.start_date, festival.end_date);

  return (
    <Link
      href={`/festivals/${festival.slug}`}
      className="group block relative overflow-hidden rounded-2xl border transition hover:scale-[1.01]"
      style={{
        background: festival.hero_image_url
          ? `linear-gradient(135deg, ${accent}dd 0%, ${shade(accent, -25)}dd 100%), url(${festival.hero_image_url}) center/cover`
          : `linear-gradient(135deg, ${accent} 0%, ${shade(accent, -25)} 100%)`,
        borderColor: `${accent}66`,
        minHeight: "180px",
      }}
    >
      <div className="relative p-5 flex flex-col h-full text-white">
        {liveBadge && (
          <span className="self-start mb-2 inline-flex items-center bg-emerald-500/90 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider animate-pulse">
            ● Live now
          </span>
        )}
        <h3 className="font-display text-xl sm:text-2xl uppercase leading-[1.05]" style={{ textShadow: "1px 1px 0 rgba(0,0,0,0.3)" }}>
          {festival.name}
        </h3>
        {festival.tagline && (
          <p className="text-sm mt-2 opacity-90 line-clamp-2">{festival.tagline}</p>
        )}
        <div className="text-xs mt-auto pt-3 font-bold uppercase tracking-wider opacity-90">
          {dateLabel}
        </div>
      </div>
    </Link>
  );
}

// Lightens / darkens a hex colour. Same helper used in the homepage banner.
function shade(hex: string, percent: number): string {
  let c = hex.replace("#", "");
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  const num = parseInt(c, 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + Math.round(2.55 * percent)));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + Math.round(2.55 * percent)));
  const b = Math.max(0, Math.min(255, (num & 0xff) + Math.round(2.55 * percent)));
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}
