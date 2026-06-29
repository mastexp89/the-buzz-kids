import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { effectiveEndTime, extractTownFromAddress } from "@/lib/utils";
import EventCard from "@/components/EventCard";
import AdminEditBar from "@/components/AdminEditBar";
import { trackPageView } from "@/lib/track";
import FavouriteButton from "@/components/FavouriteButton";
import { isFavourited } from "@/lib/favourites";
import { SOCIAL_ICON_MAP } from "@/components/SocialIcons";
import type { EventWithVenue } from "@/lib/types";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: o } = await supabase
    .from("organisers")
    .select("name, bio, image_url")
    .eq("slug", slug)
    .maybeSingle();
  if (!o) return {};
  return {
    title: `${o.name} — The Buzz Kids`,
    description: o.bio?.slice(0, 160) ?? `Events organised by ${o.name}.`,
    alternates: { canonical: `/organisers/${slug}` },
    openGraph: {
      title: `${o.name} — Events on The Buzz Guide`,
      images: o.image_url ? [o.image_url] : [],
    },
  };
}

export default async function OrganiserPage({ params }: Props) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: organiser } = await supabase
    .from("organisers")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (!organiser) notFound();
  if (!organiser.approved) notFound();

  trackPageView({ source: "organiser_page" });

  const { data: { user: viewer } } = await supabase.auth.getUser();
  const organiserFavourited = viewer ? await isFavourited("organiser", organiser.id) : false;

  // Pull events this organiser is linked to. event_organisers junction
  // → events with full venue + city info so cards can render.
  const { data: linkRows } = await supabase
    .from("event_organisers")
    .select(
      `event:events(*, venue:venues(*, city:cities(*)), event_genres(genre:genres(*)))`,
    )
    .eq("organiser_id", organiser.id);

  const now = new Date();
  const allEvents: EventWithVenue[] = (linkRows ?? [])
    .map((l: any) => l.event)
    .filter(Boolean)
    .filter((e: any) => !e.cancelled && (e.status === "approved" || e.status == null))
    .map((e: any) => ({
      ...e,
      genres: (e.event_genres ?? []).map((eg: any) => eg.genre).filter(Boolean),
    }));

  const upcoming = allEvents
    .filter((e: any) => effectiveEndTime(e, e.venue).getTime() > now.getTime())
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  const past = allEvents
    .filter((e: any) => effectiveEndTime(e, e.venue).getTime() <= now.getTime())
    .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
    .slice(0, 8);

  const socials: Array<{ key: keyof typeof SOCIAL_ICON_MAP; url: string }> = [];
  for (const k of ["website", "instagram", "facebook", "twitter", "tiktok", "spotify", "bandcamp", "youtube"] as const) {
    const v = (organiser as any)[k];
    if (v) socials.push({ key: k as any, url: v });
  }

  return (
    <div>
      <AdminEditBar
        editHref={`/dashboard/organiser/${organiser.id}/edit`}
        label="Edit organiser"
      />

      <div className="container-page py-10 sm:py-14 max-w-4xl">
        <div className="flex flex-col sm:flex-row gap-6 sm:items-center mb-8">
          {organiser.image_url ? (
            <div
              className="w-32 h-32 sm:w-40 sm:h-40 rounded-2xl bg-buzz-surface border border-buzz-border shrink-0"
              style={{
                backgroundImage: `url(${organiser.image_url})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
          ) : (
            <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-2xl bg-buzz-surface border border-buzz-border grid place-items-center text-5xl shrink-0">
              📋
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="eyebrow mb-2">Event organiser</p>
            <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
              <h1 className="h-display text-4xl sm:text-5xl flex-1 min-w-0">{organiser.name}</h1>
              {/* Prominent favourite button next to title for mobile visibility. */}
              <div className="shrink-0 sm:mt-1">
                <FavouriteButton
                  targetType="organiser"
                  targetId={organiser.id}
                  initialFavourited={organiserFavourited}
                  signedIn={!!viewer}
                />
              </div>
            </div>
            {organiser.bio && (
              <p className="text-buzz-mute max-w-2xl">{organiser.bio}</p>
            )}
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <FavouriteButton
                targetType="organiser"
                targetId={organiser.id}
                initialFavourited={organiserFavourited}
                signedIn={!!viewer}
              />
              {socials.map(({ key, url }) => {
                const Icon = SOCIAL_ICON_MAP[key];
                return (
                  <a
                    key={key}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-buzz-mute hover:text-buzz-accent transition"
                    aria-label={key}
                  >
                    {Icon ? <Icon className="w-5 h-5" /> : key}
                  </a>
                );
              })}
            </div>
          </div>
        </div>

        {upcoming.length > 0 && (
          <section className="mb-12">
            <p className="eyebrow mb-3">Upcoming</p>
            <h2 className="h-display text-2xl sm:text-3xl mb-5">
              {upcoming.length} {upcoming.length === 1 ? "event" : "events"}
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {upcoming.map((e) => (
                <EventCard
                  key={e.id}
                  event={e}
                  citySlug={(e.venue as any)?.city?.slug ?? "dundee"}
                />
              ))}
            </div>
          </section>
        )}

        {past.length > 0 && (
          <section>
            <p className="eyebrow mb-3 text-buzz-mute">Past events</p>
            <h2 className="h-display text-2xl sm:text-3xl mb-5">Recent history</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 opacity-70">
              {past.map((e) => (
                <EventCard
                  key={e.id}
                  event={e}
                  citySlug={(e.venue as any)?.city?.slug ?? "dundee"}
                />
              ))}
            </div>
          </section>
        )}

        {upcoming.length === 0 && past.length === 0 && (
          <div className="card p-10 text-center text-buzz-mute">
            No events listed for {organiser.name} yet — check back soon.
          </div>
        )}
      </div>
    </div>
  );
}
