import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { formatFestivalDateRange } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Festivals — The Buzz Guide" };

// Cross-festival picks page.
//
// For each published festival happening from yesterday onwards, count how
// many of the user's favourited artists (or directly-favourited events)
// are playing at it. Show only festivals where the user has at least one
// pick. Click a card → go straight to the festival page's "My picks" tab
// (well, the festival page in general — the tab is local state but a
// signed-in user lands on Schedule by default and can switch to Picks).
//
// Empty state walks the user through how to populate this list.

type FestivalRow = {
  id: string;
  name: string;
  slug: string;
  start_date: string;
  end_date: string;
  primary_color: string | null;
  logo_url: string | null;
  hero_image_url: string | null;
  tagline: string | null;
};

type FestivalCard = {
  festival: FestivalRow;
  pickCount: number;
  totalActs: number;
  status: "upcoming" | "live" | "past";
};

export default async function DashboardFestivalsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/festivals");

  // Get user's favourited artist + event ids — these are the "picks" we
  // match against festival lineups.
  const { data: favs } = await supabase
    .from("favourites")
    .select("target_type, target_id")
    .eq("user_id", user.id)
    .in("target_type", ["artist", "event"]);

  const favArtistIds = new Set<string>();
  const favEventIds = new Set<string>();
  for (const f of favs ?? []) {
    if ((f as any).target_type === "artist") favArtistIds.add((f as any).target_id);
    else if ((f as any).target_type === "event") favEventIds.add((f as any).target_id);
  }

  // All published festivals from yesterday onwards (so something that just
  // wrapped this morning still shows for a day).
  const sb = createServiceClient();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const { data: festivals } = await sb
    .from("festivals")
    .select("id, name, slug, start_date, end_date, primary_color, logo_url, hero_image_url, tagline")
    .eq("published", true)
    .gte("end_date", yesterday)
    .order("start_date", { ascending: true });

  // For each festival, fetch events + artists in one query and count picks.
  const cards: FestivalCard[] = [];
  for (const f of (festivals ?? []) as FestivalRow[]) {
    // Festival venues
    const { data: vRows } = await sb
      .from("festival_venues")
      .select("venue_id")
      .eq("festival_id", f.id);
    const venueIds = (vRows ?? []).map((r: any) => r.venue_id as string);
    if (venueIds.length === 0) {
      cards.push({ festival: f, pickCount: 0, totalActs: 0, status: statusOf(f) });
      continue;
    }
    // Events at festival venues during the festival window
    const startIso = `${f.start_date}T00:00:00Z`;
    const endIso = `${f.end_date}T23:59:59Z`;
    const { data: events } = await sb
      .from("events")
      .select("id, event_artists(artist_id)")
      .in("venue_id", venueIds)
      .gte("start_time", startIso)
      .lte("start_time", endIso)
      .eq("status", "approved");
    const totalActs = (events ?? []).length;
    let pickCount = 0;
    for (const e of (events ?? []) as any[]) {
      if (favEventIds.has(e.id)) {
        pickCount += 1;
        continue;
      }
      const linkedArtistIds: string[] = (e.event_artists ?? []).map((ea: any) => ea.artist_id);
      if (linkedArtistIds.some((aid) => favArtistIds.has(aid))) {
        pickCount += 1;
      }
    }
    cards.push({ festival: f, pickCount, totalActs, status: statusOf(f) });
  }

  // Sort: live first (most urgent), then upcoming with picks, then upcoming
  // without picks, past last.
  cards.sort((a, b) => {
    const order = (c: FestivalCard) => {
      if (c.status === "live") return 0;
      if (c.status === "upcoming" && c.pickCount > 0) return 1;
      if (c.status === "upcoming") return 2;
      return 3;
    };
    const oa = order(a);
    const ob = order(b);
    if (oa !== ob) return oa - ob;
    return a.festival.start_date.localeCompare(b.festival.start_date);
  });

  const withPicks = cards.filter((c) => c.pickCount > 0);
  const others = cards.filter((c) => c.pickCount === 0);

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <p className="eyebrow mb-1">My account</p>
        <h1 className="h-display text-4xl">🎪 Festivals</h1>
        <p className="text-buzz-mute mt-2 text-sm max-w-xl">
          Festivals you have picks lined up for, plus other festivals coming up
          you can browse. Heart an act on any festival page to see your personal
          schedule for that festival.
        </p>
      </div>

      {cards.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-5xl mb-3">🎪</div>
          <h2 className="font-display text-2xl mb-2">No upcoming festivals yet</h2>
          <p className="text-buzz-mute text-sm max-w-md mx-auto">
            We&apos;ll list them here as soon as the next festival gets published.
            In the meantime, head to <Link href="/" className="text-buzz-accent">the homepage</Link> to find what&apos;s on.
          </p>
        </div>
      ) : (
        <>
          {withPicks.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="eyebrow">Your picks</h2>
              {withPicks.map((c) => (
                <FestivalCardRow key={c.festival.id} card={c} highlight />
              ))}
            </section>
          )}

          {others.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="eyebrow">{withPicks.length > 0 ? "Other upcoming festivals" : "Upcoming festivals"}</h2>
              {others.map((c) => (
                <FestivalCardRow key={c.festival.id} card={c} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function statusOf(f: { start_date: string; end_date: string }): "upcoming" | "live" | "past" {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  if (today < f.start_date) return "upcoming";
  if (today > f.end_date) return "past";
  return "live";
}

function FestivalCardRow({ card, highlight }: { card: FestivalCard; highlight?: boolean }) {
  const { festival: f, pickCount, totalActs, status } = card;
  const accent = f.primary_color || "#e91e63";
  return (
    <Link
      href={`/festivals/${f.slug}`}
      className="card p-4 flex items-center gap-4 hover:opacity-95 transition"
      style={highlight ? { borderColor: `${accent}66`, background: `${accent}10` } : undefined}
    >
      {f.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={f.logo_url}
          alt={f.name}
          className="h-14 w-14 sm:h-16 sm:w-16 object-contain rounded-md bg-white/5 p-1 shrink-0"
          loading="lazy"
        />
      ) : (
        <div
          className="h-14 w-14 sm:h-16 sm:w-16 rounded-md grid place-items-center text-2xl shrink-0"
          style={{ background: `${accent}33`, color: accent }}
        >
          🎪
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-display text-xl truncate" style={{ color: accent }}>
            {f.name}
          </span>
          {status === "live" && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
              style={{ background: accent, color: "black" }}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
              Live
            </span>
          )}
        </div>
        <div className="text-xs text-buzz-mute mt-0.5">
          {formatFestivalDateRange(f.start_date, f.end_date)}
          {f.tagline && <> · {f.tagline}</>}
        </div>
        {pickCount > 0 ? (
          <div className="text-sm mt-1 font-medium" style={{ color: accent }}>
            ❤ {pickCount} of your pick{pickCount === 1 ? "" : "s"} playing
            {totalActs > 0 && <span className="text-buzz-mute font-normal"> (of {totalActs} acts)</span>}
          </div>
        ) : (
          <div className="text-xs text-buzz-mute mt-1">
            {totalActs > 0 ? `${totalActs} acts announced — heart any to add to your picks` : "Lineup TBA"}
          </div>
        )}
      </div>
      <span className="text-xs text-buzz-mute hover:text-buzz-text shrink-0">
        Open →
      </span>
    </Link>
  );
}

// Shared festival-range formatter lives in @/lib/utils so ordinals
// (30 → 30th) are consistent across festival surfaces.
