import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardHome() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: venues }, { data: artists }, { data: organisers }, { data: profile }] = await Promise.all([
    supabase
      .from("venues")
      .select("*, city:cities(name, slug)")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("artists")
      .select("id, name, slug, image_url, bio, approved")
      .eq("claimed_by", user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("organisers")
      .select("id, name, slug, image_url, approved")
      .eq("claimed_by", user.id)
      .order("created_at", { ascending: true }),
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
  ]);

  // First-timers go through the relevant setup wizard so they can claim an
  // existing unclaimed page or create new (with dupe check) — prevents
  // duplicate pages.
  if (profile?.role === "artist" && (artists ?? []).length === 0) {
    redirect("/dashboard/setup");
  }
  if (profile?.role === "event_organiser" && (organisers ?? []).length === 0) {
    redirect("/dashboard/organiser-setup");
  }

  const list = venues ?? [];
  const artistList = artists ?? [];
  const now = new Date().toISOString();
  const counts: Record<string, number> = {};
  if (list.length > 0) {
    const { data } = await supabase
      .from("events")
      .select("venue_id")
      .in("venue_id", list.map((v) => v.id))
      .gte("start_time", now)
      .eq("cancelled", false);
    for (const e of data ?? []) {
      counts[(e as any).venue_id] = (counts[(e as any).venue_id] ?? 0) + 1;
    }
  }

  const organiserList = organisers ?? [];

  if (list.length === 0 && artistList.length === 0 && organiserList.length === 0) {
    // Fan-specific welcome — fans don't want "list your venue" CTAs.
    // Point them at favourites, the day planner and browsing.
    if (profile?.role === "user") {
      return (
        <div className="flex flex-col gap-6 max-w-2xl">
          <div className="card p-8 sm:p-10">
            <p className="eyebrow mb-3">Welcome to The Buzz Kids</p>
            <h1 className="h-display text-4xl mb-3">You're all set.</h1>
            <p className="text-buzz-mute mb-6">
              Heart places and activities you love — we'll keep them saved so
              you can find them again easily. Here's where to start:
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href="/" className="btn-primary btn-lg">
                🔍 Browse activities
              </Link>
              <Link href="/dashboard/favourites" className="btn-secondary btn-lg">
                ♡ My bucket list
              </Link>
              <Link href="/surprise" className="btn-secondary btn-lg">
                🎲 Surprise me
              </Link>
            </div>
          </div>
          <div className="card p-5">
            <p className="eyebrow mb-2">💡 Quick tip</p>
            <p className="text-sm text-buzz-mute">
              Tap the heart on any place or activity to save it to your bucket list — great for building a wishlist of days out to try with the kids.
            </p>
          </div>
        </div>
      );
    }

    // Non-fan with no claimed pages yet — the original "Get listed" CTAs.
    // The four paths cover the main user types: venue owners, artists,
    // promoters (organisers — they don't own a venue but book gigs at
    // different ones), and a fallback to fan browsing for anyone who
    // landed here by mistake.
    return (
      <div className="card p-10 max-w-2xl">
        <p className="eyebrow mb-3">Welcome aboard</p>
        <h1 className="h-display text-4xl mb-3">Get listed in 2 minutes.</h1>
        <p className="text-buzz-mute mb-6">
          Pick what you&apos;re here for and we&apos;ll get your listing live.
        </p>
        <div className="flex flex-col gap-3">
          <Link
            href="/dashboard/venue-setup"
            className="card p-4 hover:border-buzz-accent transition flex items-start gap-4"
          >
            <span className="text-2xl">🏡</span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-base">I run a place or activity</div>
              <p className="text-xs text-buzz-mute mt-0.5">
                Soft play, farm, museum, leisure centre, climbing wall — list your
                place and manage your sessions, prices and photos.
              </p>
            </div>
            <span className="text-buzz-mute text-xl shrink-0">→</span>
          </Link>
          <Link
            href="/dashboard/organiser-setup"
            className="card p-4 hover:border-buzz-accent transition flex items-start gap-4"
          >
            <span className="text-2xl">📣</span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-base">
                I run events or classes
                <span className="text-buzz-accent text-[10px] ml-2 uppercase tracking-wider">no fixed venue</span>
              </div>
              <p className="text-xs text-buzz-mute mt-0.5">
                Holiday clubs, touring workshops, pop-up events. Publish activities
                under your organiser name across different venues.
              </p>
            </div>
            <span className="text-buzz-mute text-xl shrink-0">→</span>
          </Link>
        </div>
      </div>
    );
  }

  // Organiser-only view (no claimed places yet)
  if (list.length === 0 && organiserList.length > 0) {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow mb-1">Your dashboard</p>
            <h1 className="h-display text-4xl sm:text-5xl">Your organiser {organiserList.length === 1 ? "page" : "pages"}</h1>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {organiserList.map((o: any) => (
            <Link
              key={o.id}
              href={`/dashboard/organiser/${o.id}/edit`}
              className="card-hover p-5 flex gap-4 items-start lift"
            >
              {o.image_url ? (
                <div
                  className="w-16 h-16 rounded-full bg-buzz-surface shrink-0"
                  style={{ backgroundImage: `url(${o.image_url})`, backgroundSize: "cover", backgroundPosition: "center" }}
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-buzz-surface border border-buzz-border grid place-items-center text-buzz-accent text-2xl shrink-0">📣</div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {o.approved ? (
                    <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-400">● Live</span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wider font-bold text-buzz-accent">● Pending</span>
                  )}
                </div>
                <h2 className="font-display text-2xl uppercase truncate leading-tight">{o.name}</h2>
              </div>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-1">Your dashboard</p>
          <h1 className="h-display text-4xl sm:text-5xl">Your places</h1>
        </div>
        <Link href="/dashboard/venue-setup" className="btn-primary">+ Add place</Link>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {list.map((v) => {
          const upcoming = counts[v.id] ?? 0;
          return (
            <Link
              key={v.id}
              href={`/dashboard/venues/${v.id}`}
              className="card-hover p-5 flex gap-4 items-start lift"
            >
              {v.logo_url ? (
                <div
                  className="w-16 h-16 rounded-xl bg-buzz-surface border border-buzz-border shrink-0"
                  style={{ backgroundImage: `url(${v.logo_url})`, backgroundSize: "contain", backgroundPosition: "center", backgroundRepeat: "no-repeat" }}
                />
              ) : (
                <div className="w-16 h-16 rounded-xl bg-buzz-surface border border-buzz-border grid place-items-center text-buzz-accent text-2xl shrink-0">🐝</div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {v.approved ? (
                    <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-400">● Live</span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wider font-bold text-buzz-accent">● Pending</span>
                  )}
                  <span className="text-[10px] uppercase tracking-wider text-buzz-mute">{(v.city as any)?.name}</span>
                </div>
                <h2 className="font-display text-2xl uppercase truncate leading-tight">{v.name}</h2>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-display text-2xl text-buzz-accent leading-none">{upcoming}</span>
                  <span className="text-xs text-buzz-mute">upcoming {upcoming === 1 ? "session" : "sessions"}</span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
