import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getMyFavourites } from "@/lib/favourites";
import { effectiveEndTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Favourites — The Buzz Guide" };

type Tab = "events" | "venues" | "artists" | "organisers";

type Props = { searchParams: Promise<{ tab?: string }> };

export default async function FavouritesPage({ searchParams }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/favourites");

  const sp = await searchParams;
  const tab = ((sp.tab ?? "events") as Tab);

  const favs = await getMyFavourites();
  const sb = createServiceClient();

  // Fetch the actual entity rows for each list so we can render names,
  // images, dates, links. Empty arrays produce no DB load.
  const [venuesData, artistsData, organisersData, eventsData] = await Promise.all([
    favs.venueIds.length > 0
      ? sb.from("venues").select("id, name, slug, logo_url, cover_photo_url, address, city:cities(slug, name)").in("id", favs.venueIds).eq("approved", true)
      : Promise.resolve({ data: [] as any[] }),
    favs.artistIds.length > 0
      ? sb.from("artists").select("id, name, slug, image_url").in("id", favs.artistIds).eq("approved", true)
      : Promise.resolve({ data: [] as any[] }),
    favs.organiserIds.length > 0
      ? sb.from("organisers").select("id, name, slug, image_url").in("id", favs.organiserIds).eq("approved", true)
      : Promise.resolve({ data: [] as any[] }),
    favs.eventIds.length > 0
      ? sb.from("events").select("id, title, start_time, end_time, image_url, cancelled, venue:venues(name, slug, city:cities(slug))").in("id", favs.eventIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  // Filter past events client-side based on effectiveEndTime
  const now = new Date();
  const upcomingEvents = ((eventsData.data ?? []) as any[]).filter((e) => {
    if (!e.start_time) return false;
    const venue = e.venue ?? {};
    const end = effectiveEndTime(e as any, venue);
    return end > now;
  }).sort((a: any, b: any) => a.start_time.localeCompare(b.start_time));

  const totals = {
    events: upcomingEvents.length,
    venues: (venuesData.data ?? []).length,
    artists: (artistsData.data ?? []).length,
    organisers: (organisersData.data ?? []).length,
  };

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div>
        <p className="eyebrow mb-1">My account</p>
        <h1 className="h-display text-4xl">♡ Favourites</h1>
        <p className="text-buzz-mute mt-2 text-sm max-w-xl">
          Everything you&apos;ve saved. We&apos;ll email you when there are new gigs
          at venues / artists / organisers you follow, on the morning of any
          gig you&apos;ve saved, and 15 minutes before it starts.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-buzz-border/60 pb-2">
        <TabLink active={tab === "events"} href="/dashboard/favourites?tab=events" label={`🎟️ Gigs (${totals.events})`} />
        <TabLink active={tab === "venues"} href="/dashboard/favourites?tab=venues" label={`🐝 Venues (${totals.venues})`} />
        <TabLink active={tab === "artists"} href="/dashboard/favourites?tab=artists" label={`🎤 Artists (${totals.artists})`} />
        <TabLink active={tab === "organisers"} href="/dashboard/favourites?tab=organisers" label={`📋 Organisers (${totals.organisers})`} />
      </div>

      {tab === "events" && (
        upcomingEvents.length === 0 ? (
          <Empty
            heading="No upcoming gigs saved"
            body="Tap the ♡ on any gig page and we'll send you a reminder on the morning of, and 15 minutes before it starts."
          />
        ) : (
          <ul className="card divide-y divide-buzz-border/60">
            {upcomingEvents.map((e: any) => (
              <li key={e.id} className="p-4 flex items-start gap-3">
                <div className="text-2xl">🎟️</div>
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/${e.venue?.city?.slug ?? "dundee"}/events/${e.id}`}
                    className="font-medium hover:text-buzz-accent transition truncate block"
                  >
                    {e.title}
                  </Link>
                  <div className="text-xs text-buzz-mute mt-0.5">
                    {new Date(e.start_time).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {e.venue?.name && <> · at {e.venue.name}</>}
                    {e.cancelled && <span className="text-rose-400"> · cancelled</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === "venues" && (
        (venuesData.data ?? []).length === 0 ? (
          <Empty
            heading="No venues saved"
            body="Heart a venue page and we'll email you whenever they add a new gig."
          />
        ) : (
          <ul className="card divide-y divide-buzz-border/60">
            {(venuesData.data ?? []).map((v: any) => (
              <li key={v.id} className="p-4 flex items-center gap-3">
                <div className="text-2xl">🐝</div>
                <Link
                  href={`/${v.city?.slug ?? "dundee"}/venues/${v.slug}`}
                  className="flex-1 min-w-0 font-medium hover:text-buzz-accent transition truncate"
                >
                  {v.name}
                  <span className="text-buzz-mute font-normal"> · {v.city?.name ?? ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === "artists" && (
        (artistsData.data ?? []).length === 0 ? (
          <Empty
            heading="No artists saved"
            body="Heart an artist page and we'll email you whenever they get tagged on a new gig at any venue."
          />
        ) : (
          <ul className="card divide-y divide-buzz-border/60">
            {(artistsData.data ?? []).map((a: any) => (
              <li key={a.id} className="p-4 flex items-center gap-3">
                <div className="text-2xl">🎤</div>
                <Link href={`/artists/${a.slug}`} className="flex-1 min-w-0 font-medium hover:text-buzz-accent transition truncate">
                  {a.name}
                </Link>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === "organisers" && (
        (organisersData.data ?? []).length === 0 ? (
          <Empty
            heading="No organisers saved"
            body="Heart an organiser page and we'll email you whenever they announce a new show."
          />
        ) : (
          <ul className="card divide-y divide-buzz-border/60">
            {(organisersData.data ?? []).map((o: any) => (
              <li key={o.id} className="p-4 flex items-center gap-3">
                <div className="text-2xl">📋</div>
                <Link href={`/organisers/${o.slug}`} className="flex-1 min-w-0 font-medium hover:text-buzz-accent transition truncate">
                  {o.name}
                </Link>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

function TabLink({ active, href, label }: { active: boolean; href: string; label: string }) {
  return (
    <Link
      href={href}
      className={
        active
          ? "px-3 py-1.5 rounded-full text-sm font-semibold bg-buzz-accent text-black"
          : "px-3 py-1.5 rounded-full text-sm bg-buzz-card border border-buzz-border hover:border-buzz-accent transition"
      }
    >
      {label}
    </Link>
  );
}

function Empty({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="card p-10 text-center">
      <div className="text-5xl mb-3">♡</div>
      <h2 className="font-display text-2xl mb-2">{heading}</h2>
      <p className="text-buzz-mute text-sm max-w-md mx-auto">{body}</p>
    </div>
  );
}
