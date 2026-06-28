import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import EventCard from "@/components/EventCard";
import ShareButtons from "@/components/ShareButtons";
import { SOCIAL_ICON_MAP } from "@/components/SocialIcons";
import { effectiveEndTime, formatFestivalDateRange } from "@/lib/utils";
import type { EventWithVenue } from "@/lib/types";
import { trackPageView } from "@/lib/track";
import FavouriteButton from "@/components/FavouriteButton";
import { isFavourited } from "@/lib/favourites";
import TrackedLink from "@/components/TrackedLink";
import AdminEditBar from "@/components/AdminEditBar";
import SpotifyEmbed from "@/components/SpotifyEmbed";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: a } = await supabase
    .from("artists").select("name, bio, image_url").eq("slug", slug).single();
  if (!a) return {};
  return {
    title: `${a.name} — gigs in Scotland | The Buzz Guide`,
    description: a.bio?.slice(0, 160) ?? `Upcoming gigs by ${a.name} on The Buzz Guide.`,
    alternates: { canonical: `/artists/${slug}` },
    openGraph: {
      title: `${a.name} — Upcoming gigs`,
      images: a.image_url ? [a.image_url] : [],
    },
  };
}

const SOCIAL_LINKS = [
  { key: "website", label: "Website" },
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
  { key: "twitter", label: "X / Twitter" },
  { key: "spotify", label: "Spotify" },
  { key: "bandcamp", label: "Bandcamp" },
  { key: "youtube", label: "YouTube" },
];

export default async function ArtistPage({ params }: Props) {
  const supabase = await createClient();
  const { slug } = await params;
  const { data: artist } = await supabase
    .from("artists")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  // If we don't find the artist by slug, check for a redirect — admin may
  // have renamed the slug, in which case we 301 to the new URL.
  if (!artist) {
    const { data: redirectRow } = await supabase
      .from("slug_redirects")
      .select("new_slug")
      .eq("resource_type", "artist")
      .eq("old_slug", slug)
      .is("city_slug", null)
      .maybeSingle();
    if (redirectRow?.new_slug) redirect(`/artists/${redirectRow.new_slug}`);
    notFound();
  }
  if (!artist.approved) notFound();

  trackPageView({ artistId: artist.id, source: "artist_page" });

  const { data: { user: viewer } } = await supabase.auth.getUser();
  const artistFavourited = viewer ? await isFavourited("artist", artist.id) : false;

  // Find upcoming gigs at any approved venue tagged with this artist
  const now = new Date().toISOString();
  const { data: links } = await supabase
    .from("event_artists")
    .select("event_id")
    .eq("artist_id", artist.id);
  const eventIds = (links ?? []).map((l) => l.event_id);

  let events: EventWithVenue[] = [];
  if (eventIds.length > 0) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const { data: rawEvents } = await supabase
      .from("events")
      .select(`*, venue:venues!inner(*, city:cities!inner(*)), event_genres ( genre:genres(*) )`)
      .in("id", eventIds)
      .gte("start_time", startOfToday.toISOString())
      .eq("cancelled", false)
      .eq("status", "approved")
      .eq("venue.approved", true)
      .order("start_time", { ascending: true });

    const nowDate = new Date();
    events = (rawEvents ?? [])
      .filter((e: any) => effectiveEndTime(e, e.venue).getTime() > nowDate.getTime())
      .map((e: any) => ({
        ...e,
        genres: (e.event_genres ?? []).map((eg: any) => eg.genre).filter(Boolean),
      }));
  }

  // Festival appearances (sql/056). Separate from `events` — the typed-in
  // festival lineup lets admins announce who's playing where without
  // creating individual event rows per act. Surface them here so an
  // artist's page reflects festival bookings even when no per-act
  // event has been published yet.
  const today = new Date().toISOString().slice(0, 10);
  const { data: rawLineup } = await supabase
    .from("festival_lineup")
    .select(`
      id, performance_time, stage,
      festival:festivals!inner(id, name, slug, start_date, end_date, primary_color, hero_image_url, published)
    `)
    .eq("artist_id", artist.id)
    .eq("festival.published", true)
    .gte("festival.end_date", today);

  type FestivalAppearance = {
    id: string;
    performance_time: string | null;
    stage: string | null;
    festival: {
      id: string;
      name: string;
      slug: string;
      start_date: string;
      end_date: string;
      primary_color: string | null;
      hero_image_url: string | null;
    };
  };
  // Sort by festival start_date (soonest first), then by performance_time
  // within a festival (timed slots before TBA).
  const festivalAppearances: FestivalAppearance[] = ((rawLineup ?? []) as any as FestivalAppearance[])
    .slice()
    .sort((a, b) => {
      const sd = a.festival.start_date.localeCompare(b.festival.start_date);
      if (sd !== 0) return sd;
      if (a.performance_time && b.performance_time) {
        return a.performance_time.localeCompare(b.performance_time);
      }
      if (a.performance_time) return -1;
      if (b.performance_time) return 1;
      return 0;
    });

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thebuzzguide.co.uk";

  // Social link list
  const socials = SOCIAL_LINKS
    .map((s) => ({ ...s, url: (artist as any)[s.key] as string | null }))
    .filter((s) => !!s.url);

  // JSON-LD: MusicGroup
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "MusicGroup",
    name: artist.name,
    description: artist.bio ?? `Artist page on The Buzz Guide`,
    url: `${siteUrl}/artists/${artist.slug}`,
    image: artist.image_url ?? undefined,
    sameAs: socials.map((s) => s.url),
  };

  return (
    <div>
      <AdminEditBar
        editHref={`/dashboard/artist/${artist.id}/edit`}
        label="Edit artist"
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="container-page py-12 sm:py-16 max-w-5xl">
        <div className="grid md:grid-cols-[auto_1fr] gap-8 items-start">
          {/* Avatar */}
          <div className="shrink-0">
            {artist.image_url ? (
              <div
                className="w-40 h-40 sm:w-48 sm:h-48 rounded-2xl bg-buzz-surface border border-buzz-border"
                style={{ backgroundImage: `url(${artist.image_url})`, backgroundSize: "cover", backgroundPosition: "center" }}
              />
            ) : (
              <div className="w-40 h-40 sm:w-48 sm:h-48 rounded-2xl bg-gradient-to-br from-buzz-accent/30 to-buzz-card border border-buzz-border grid place-items-center">
                <span className="text-6xl">🎵</span>
              </div>
            )}
          </div>
          {/* Info */}
          <div className="flex flex-col gap-3 min-w-0">
            <p className="eyebrow">Artist</p>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <h1 className="h-display text-5xl sm:text-7xl break-words flex-1 min-w-0">{artist.name}</h1>
              {/* Prominent favourite button next to title for mobile visibility. */}
              <div className="shrink-0 sm:mt-2">
                <FavouriteButton
                  targetType="artist"
                  targetId={artist.id}
                  initialFavourited={artistFavourited}
                  signedIn={!!viewer}
                />
              </div>
            </div>
            {artist.bio ? (
              <p className="text-buzz-text/90 leading-relaxed whitespace-pre-line mt-2">{artist.bio}</p>
            ) : !artist.claimed_by ? (
              <p className="text-buzz-mute italic">
                This page was auto-created from a venue's gig listing.
                Are you {artist.name}?{" "}
                <Link
                  href={`/artists/${artist.slug}/claim`}
                  className="text-buzz-accent hover:text-buzz-accent2"
                >
                  Claim this page →
                </Link>
              </p>
            ) : null}
            {socials.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {socials.map((s) => {
                  const Icon = SOCIAL_ICON_MAP[s.key];
                  return (
                    <TrackedLink
                      key={s.key}
                      href={s.url as string}
                      kind={`click_${s.key}`}
                      artistId={artist.id}
                      target="_blank"
                      rel="noreferrer"
                      ariaLabel={s.label}
                      title={s.label}
                      className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-buzz-card border border-buzz-border hover:border-buzz-accent hover:text-buzz-accent transition"
                    >
                      {Icon ? <Icon size={16} /> : s.label.charAt(0).toUpperCase()}
                    </TrackedLink>
                  );
                })}
              </div>
            )}
            <div className="pt-4 mt-2 border-t border-buzz-border/50 flex flex-wrap items-center gap-3">
              <FavouriteButton
                targetType="artist"
                targetId={artist.id}
                initialFavourited={artistFavourited}
                signedIn={!!viewer}
              />
              <div className="ml-auto">
                <ShareButtons
                  url={`${siteUrl}/artists/${artist.slug}`}
                  title={`${artist.name} — gigs on The Buzz Guide`}
                  size="sm"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Spotify embed — only renders when the artist has a Spotify URL
            on file. Sits above the claim CTA so the page leads with the
            artist's music before asking them to take ownership. */}
        {artist.spotify && (
          <section className="mt-10">
            <p className="eyebrow mb-2">Listen</p>
            <SpotifyEmbed url={artist.spotify} />
          </section>
        )}

        {!artist.claimed_by && (
          <section className="mt-10">
            <div className="card p-6 sm:p-7 border-buzz-accent/40 bg-buzz-accent/5 flex flex-col sm:flex-row sm:items-center gap-4 sm:justify-between">
              <div className="flex-1 min-w-0">
                <p className="eyebrow mb-1 text-buzz-accent">For the artist</p>
                <h3 className="h-display text-2xl mb-1">Is this you?</h3>
                <p className="text-sm text-buzz-mute max-w-xl">
                  This page hasn't been claimed yet. If you are {artist.name} (or
                  manage them), take ownership to add a profile photo, bio, and
                  socials, and have all your gigs auto-show up here.
                </p>
              </div>
              <Link
                href={`/artists/${artist.slug}/claim`}
                className="btn-primary shrink-0"
              >
                Take ownership →
              </Link>
            </div>
          </section>
        )}

        {/* Festival appearances — from festival_lineup (sql/056). Only
            rendered when this artist is on at least one upcoming/active
            festival's lineup. Sits above individual gigs because festival
            slots tend to be the bigger deal for an artist's page. */}
        {festivalAppearances.length > 0 && (
          <section className="mt-14">
            <p className="eyebrow mb-2">Festivals</p>
            <h2 className="h-display text-3xl sm:text-4xl mb-6">
              Playing at {festivalAppearances.length === 1 ? "1 festival" : `${festivalAppearances.length} festivals`}
            </h2>
            <ul className="flex flex-col gap-3">
              {festivalAppearances.map((row) => {
                const accent = row.festival.primary_color || "#fdb913";
                const dateLabel = formatFestivalDateRange(
                  row.festival.start_date,
                  row.festival.end_date,
                );
                const timeLabel = row.performance_time
                  ? new Date(row.performance_time).toLocaleString("en-GB", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Europe/London",
                    })
                  : "Time TBA";
                return (
                  <li key={row.id}>
                    <Link
                      href={`/festivals/${row.festival.slug}`}
                      className="card p-4 flex items-center gap-4 hover:border-buzz-accent transition"
                      style={{ borderLeft: `3px solid ${accent}` }}
                    >
                      <div
                        className="w-14 h-14 shrink-0 rounded-md bg-buzz-surface border border-buzz-border overflow-hidden"
                        style={
                          row.festival.hero_image_url
                            ? {
                                backgroundImage: `url(${row.festival.hero_image_url})`,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                              }
                            : undefined
                        }
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-display text-xl uppercase truncate" style={{ color: accent }}>
                          {row.festival.name}
                        </div>
                        <div className="text-xs text-buzz-mute mt-0.5 truncate">
                          {dateLabel}
                        </div>
                        <div className="text-xs text-buzz-mute mt-0.5 truncate">
                          {timeLabel}
                          {row.stage && <> · <span>{row.stage}</span></>}
                        </div>
                      </div>
                      <span className="shrink-0 text-buzz-mute" aria-hidden>→</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Upcoming gigs — only rendered when there are actual gigs OR
            when there's nothing else to show. Suppressing the "no gigs"
            empty state when festivals exist avoids the contradiction of
            "Playing at 2 festivals" sitting next to "No upcoming gigs". */}
        {(events.length > 0 || festivalAppearances.length === 0) && (
          <section className="mt-14">
            <p className="eyebrow mb-2">Upcoming</p>
            <h2 className="h-display text-3xl sm:text-4xl mb-6">
              {events.length === 0 ? "No upcoming gigs" : `${events.length} ${events.length === 1 ? "gig" : "gigs"} coming up`}
            </h2>
            {events.length === 0 ? (
              <div className="card p-10 text-center">
                <div className="text-4xl mb-3">🎤</div>
                <p className="text-buzz-mute">
                  No gigs from {artist.name} on The Buzz Guide right now. Check back soon, or{" "}
                  <Link href="/" className="text-buzz-accent">browse what's on</Link>.
                </p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {events.map((e) => <EventCard key={e.id} event={e} citySlug={(e.venue as any).city.slug} />)}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
