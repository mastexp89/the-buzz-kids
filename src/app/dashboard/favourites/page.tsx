import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getMyFavourites } from "@/lib/favourites";
import { effectiveEndTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bucket list — The Buzz Kids" };

type Tab = "places" | "activities";

type Props = { searchParams: Promise<{ tab?: string }> };

export default async function BucketListPage({ searchParams }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/favourites");

  const sp = await searchParams;
  const tab = ((sp.tab ?? "places") as Tab);

  const favs = await getMyFavourites();
  const sb = createServiceClient();

  const [venuesData, eventsData] = await Promise.all([
    favs.venueIds.length > 0
      ? sb.from("venues").select("id, name, slug, cover_photo_url, google_photo_url, image_url, address, city:cities(slug, name)").in("id", favs.venueIds).eq("approved", true)
      : Promise.resolve({ data: [] as any[] }),
    favs.eventIds.length > 0
      ? sb.from("events").select("id, title, start_time, end_time, image_url, cancelled, venue:venues(name, slug, city:cities(slug))").in("id", favs.eventIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const now = new Date();
  const upcomingEvents = ((eventsData.data ?? []) as any[]).filter((e) => {
    if (!e.start_time) return false;
    return effectiveEndTime(e as any, e.venue ?? {}) > now;
  }).sort((a: any, b: any) => a.start_time.localeCompare(b.start_time));

  const totals = {
    places: (venuesData.data ?? []).length,
    activities: upcomingEvents.length,
  };

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div>
        <p className="eyebrow mb-1">My account</p>
        <h1 className="h-display text-4xl">♡ Bucket list</h1>
        <p className="text-buzz-mute mt-2 text-sm max-w-xl">
          Places and activities you&apos;ve saved for a rainy day (or a sunny one). Tap the ♡ on any
          place or activity to add it here.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-buzz-border/60 pb-2">
        <TabLink active={tab === "places"} href="/dashboard/favourites?tab=places" label={`🐝 Places (${totals.places})`} />
        <TabLink active={tab === "activities"} href="/dashboard/favourites?tab=activities" label={`🎟️ Activities (${totals.activities})`} />
      </div>

      {tab === "places" && (
        (venuesData.data ?? []).length === 0 ? (
          <Empty heading="No places saved yet" body="Found somewhere you'd love to take the kids? Tap the ♡ on its page to save it to your bucket list." />
        ) : (
          <ul className="card divide-y divide-buzz-border/60">
            {(venuesData.data ?? []).map((v: any) => (
              <li key={v.id} className="p-4 flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-xl bg-buzz-surface bg-cover bg-center shrink-0 grid place-items-center text-xl"
                  style={(v.cover_photo_url || v.google_photo_url || v.image_url) ? { backgroundImage: `url(${v.cover_photo_url || v.google_photo_url || v.image_url})` } : undefined}
                >
                  {!(v.cover_photo_url || v.google_photo_url || v.image_url) && <span aria-hidden>🐝</span>}
                </div>
                <Link href={`/${v.city?.slug ?? "dundee"}/venues/${v.slug}`} className="flex-1 min-w-0 font-medium hover:text-buzz-accent transition truncate">
                  {v.name}
                  <span className="text-buzz-mute font-normal"> · {v.city?.name ?? ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === "activities" && (
        upcomingEvents.length === 0 ? (
          <Empty heading="No activities saved" body="Tap the ♡ on a dated activity (a holiday camp, a show, a class) and we'll keep it here with a reminder before it starts." />
        ) : (
          <ul className="card divide-y divide-buzz-border/60">
            {upcomingEvents.map((e: any) => (
              <li key={e.id} className="p-4 flex items-start gap-3">
                <div className="text-2xl">🎟️</div>
                <div className="flex-1 min-w-0">
                  <Link href={`/${e.venue?.city?.slug ?? "dundee"}/events/${e.id}`} className="font-medium hover:text-buzz-accent transition truncate block">
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
    </div>
  );
}

function TabLink({ active, href, label }: { active: boolean; href: string; label: string }) {
  return (
    <Link
      href={href}
      className={
        active
          ? "px-3 py-1.5 rounded-full text-sm font-semibold bg-buzz-accent text-white"
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
