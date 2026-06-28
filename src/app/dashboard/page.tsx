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
            <p className="eyebrow mb-3">Welcome to The Buzz Guide</p>
            <h1 className="h-display text-4xl mb-3">You're all set.</h1>
            <p className="text-buzz-mute mb-6">
              Heart venues, bands and gigs you like — we'll email you when
              they post something new and remind you on the day. Here's where
              to go:
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href="/" className="btn-primary btn-lg">
                🔍 Browse what's on
              </Link>
              <Link href="/dashboard/favourites" className="btn-secondary btn-lg">
                ♡ My favourites
              </Link>
              <Link href="/dashboard/today" className="btn-secondary btn-lg">
                📍 Day planner
              </Link>
            </div>
          </div>
          <div className="card p-5">
            <p className="eyebrow mb-2">💡 Quick tip</p>
            <p className="text-sm text-buzz-mute">
              Tap the heart on any venue, artist or gig to save it. The day
              planner builds a map of everywhere you're heading on a given
              day — handy for festivals or busy weekends.
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
          Pick what you&apos;re here for and we&apos;ll get your page live.
        </p>
        <div className="flex flex-col gap-3">
          <Link
            href="/dashboard/venue-setup"
            className="card p-4 hover:border-buzz-accent transition flex items-start gap-4"
          >
            <span className="text-2xl">🏛️</span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-base">I run a venue</div>
              <p className="text-xs text-buzz-mute mt-0.5">
                A pub, bar, club or arts space hosting live music. Lists your
                place + lets you publish your own gigs.
              </p>
            </div>
            <span className="text-buzz-mute text-xl shrink-0">→</span>
          </Link>
          <Link
            href="/dashboard/setup"
            className="card p-4 hover:border-buzz-accent transition flex items-start gap-4"
          >
            <span className="text-2xl">🎤</span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-base">I&apos;m an artist / band / DJ</div>
              <p className="text-xs text-buzz-mute mt-0.5">
                Get an artist page that ranks in Google + submit your own gigs
                at any venue on Buzz.
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
                I&apos;m a promoter / organiser
                <span className="text-buzz-accent text-[10px] ml-2 uppercase tracking-wider">no venue needed</span>
              </div>
              <p className="text-xs text-buzz-mute mt-0.5">
                You book gigs at different venues — pop-ups, festivals,
                touring nights. Publish events under your promoter name; if
                the venue isn&apos;t on Buzz yet, you can add it as you go.
              </p>
            </div>
            <span className="text-buzz-mute text-xl shrink-0">→</span>
          </Link>
        </div>
      </div>
    );
  }

  // Artist-only view: their artist card(s) and a CTA to submit gigs
  if (list.length === 0 && artistList.length > 0) {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow mb-1">Your dashboard</p>
            <h1 className="h-display text-4xl sm:text-5xl">Your artist {artistList.length === 1 ? "page" : "pages"}</h1>
          </div>
          <Link href="/submit-gig" className="btn-primary">+ Submit a gig</Link>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {artistList.map((a: any) => (
            <Link
              key={a.id}
              href={`/dashboard/artist/${a.id}/edit`}
              className="card-hover p-5 flex gap-4 items-start lift"
            >
              {a.image_url ? (
                <div
                  className="w-16 h-16 rounded-full bg-buzz-surface shrink-0"
                  style={{ backgroundImage: `url(${a.image_url})`, backgroundSize: "cover", backgroundPosition: "center" }}
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-buzz-surface border border-buzz-border grid place-items-center text-buzz-accent text-2xl shrink-0">🎤</div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {a.approved ? (
                    <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-400">● Live</span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wider font-bold text-buzz-accent">● Pending</span>
                  )}
                </div>
                <h2 className="font-display text-2xl uppercase truncate leading-tight">{a.name}</h2>
                <p className="text-xs text-buzz-mute mt-2">
                  {a.bio ? a.bio.slice(0, 100) + (a.bio.length > 100 ? "…" : "") : "Add a bio, photo and your socials →"}
                </p>
              </div>
            </Link>
          ))}
        </div>
        <div className="card p-5">
          <p className="eyebrow mb-2">📣 Spread the word</p>
          <p className="text-buzz-mute text-sm mb-3">
            Anywhere you're playing? Submit it and your gig will show up on both the venue page and your artist page automatically.
          </p>
          <Link href="/submit-gig" className="btn-primary">Submit a gig</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-1">Your dashboard</p>
          <h1 className="h-display text-4xl sm:text-5xl">Your venues</h1>
        </div>
        <Link href="/dashboard/venue-setup" className="btn-primary">+ Add venue</Link>
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
                  <span className="text-xs text-buzz-mute">upcoming {upcoming === 1 ? "gig" : "gigs"}</span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
