import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatLongDate, formatEventTime, pickEventIcon } from "@/lib/utils";
import ShareButtons from "@/components/ShareButtons";
import { trackPageView } from "@/lib/track";
import AdminEditBar from "@/components/AdminEditBar";
import AdminExpireEventButton from "@/components/AdminExpireEventButton";
import EventHeroImage from "@/components/EventHeroImage";
import FavouriteButton from "@/components/FavouriteButton";
import { isFavourited } from "@/lib/favourites";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ city: string; id: string }> };

export async function generateMetadata({ params }: Props) {
  const supabase = await createClient();
  const { id, city } = await params;
  const { data: e } = await supabase.from("events").select("title, venue:venues(name), location_name, image_url").eq("id", id).single();
  if (!e) return {};
  const where = (e.venue as any)?.name ?? (e as any).location_name ?? "near you";
  return {
    title: `${e.title} — The Buzz Kids`,
    description: `${e.title} at ${where}.`,
    // Canonical: tells Google THIS URL is the authoritative one.
    alternates: { canonical: `/${city}/events/${id}` },
    openGraph: {
      title: `${e.title} — ${where}`,
      images: e.image_url ? [e.image_url] : [],
    },
  };
}

export default async function EventPage({ params }: Props) {
  const supabase = await createClient();
  const { id, city: citySlug } = await params;
  const { data: event } = await supabase
    .from("events")
    .select(`
      *,
      venue:venues ( *, city:cities (*) ),
      city:cities ( * ),
      event_genres ( genre:genres ( * ) ),
      event_artists ( artist:artists ( id, name, slug ) ),
      event_organisers ( organiser:organisers ( id, name, slug, approved ) ),
      festival:festivals ( id, name, slug, start_date, end_date, primary_color, logo_url, published )
    `)
    .eq("id", id)
    .single();

  if (!event) notFound();
  // Venue is optional — a town-wide event can stand alone with just a
  // location_name + city. Fall back to the event's own city when unattached.
  const venue = (event.venue as any) || null;
  const eventCity = venue?.city ?? (event as any).city ?? null;
  if (!eventCity || eventCity.slug !== citySlug) notFound();
  if (venue && !venue.approved) notFound();
  // Hide pending/rejected events from the public detail page
  if (event.status && event.status !== "approved") notFound();
  // Human label for the location, whether attached to a venue or not.
  const placeName: string = venue?.name ?? (event as any).location_name ?? eventCity.name;

  trackPageView({ eventId: event.id, venueId: (event.venue as any)?.id, source: "event_page" });

  // Heart button needs to know if the current viewer has already
  // favourited this event so it renders filled vs outlined correctly.
  const { data: { user: viewer } } = await supabase.auth.getUser();
  const eventFavourited = viewer ? await isFavourited("event", event.id) : false;

  const genres = (event.event_genres ?? []).map((eg: any) => eg.genre).filter(Boolean);
  const artists = (event.event_artists ?? []).map((ea: any) => ea.artist).filter(Boolean);
  // Only show organisers whose page has been approved by admin (otherwise we'd
  // leak unverified pages and create dead links).
  const organisers = (event.event_organisers ?? [])
    .map((eo: any) => eo.organiser)
    .filter((o: any) => o && o.approved);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thebuzzguide.co.uk";
  const eventUrl = `${siteUrl}/${citySlug}/events/${event.id}`;

  // Hero card image: real event poster or a category-aware icon picked
  // from the event's genre tags. Neutral 🎟️ fallback when nothing matches
  // — we never assume "music" for unknown categories.
  const heroPhoto = event.image_url ?? null;
  const fallbackIcon = pickEventIcon(
    event.title,
    genres.map((g: any) => g.slug),
  );
  // Fall back to date-only end (YYYY-MM-DD) when no specific end time is set,
  // so Google's structured data check has an endDate without us inventing a clock time.
  const endDateFallback = event.start_time ? String(event.start_time).split("T")[0] : undefined;
  // Image always populated for schema.org (Google's structured-data check
  // warns when missing). Fall back chain: event poster → venue cover →
  // venue logo → site logo.
  const schemaImage =
    event.image_url ||
    venue?.cover_photo_url ||
    venue?.logo_url ||
    `${siteUrl}/logo.png`;
  // Performer always populated. Tagged artists if any, otherwise the
  // place itself as a PerformingGroup — better than omitting for events
  // without specific acts.
  const schemaPerformer =
    artists.length > 0
      ? artists.map((a: any) => ({ "@type": "MusicGroup", name: a.name }))
      : [{ "@type": "PerformingGroup", name: placeName }];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ChildrensEvent",
    name: event.title,
    description: event.description ?? `${event.title} at ${placeName}`,
    startDate: event.start_time,
    endDate: event.end_time ?? endDateFallback,
    eventStatus: event.cancelled ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    image: [schemaImage],
    url: eventUrl,
    performer: schemaPerformer,
    organizer: {
      "@type": "Organization",
      name: placeName,
      url: venue?.slug ? `${siteUrl}/${citySlug}/venues/${venue.slug}` : siteUrl,
    },
    offers: {
      "@type": "Offer",
      url: event.ticket_url || eventUrl,
      price: "0",
      priceCurrency: "GBP",
      availability: event.cancelled ? "https://schema.org/SoldOut" : "https://schema.org/InStock",
      validFrom: event.created_at ?? event.start_time,
    },
    location: {
      "@type": "Place",
      name: placeName,
      address: {
        "@type": "PostalAddress",
        streetAddress: venue?.address ?? undefined,
        postalCode: venue?.postcode ?? undefined,
        addressLocality: eventCity?.name ?? undefined,
        addressCountry: "GB",
      },
    },
  };

  return (
    <div>
      <AdminEditBar
        editHref={`/dashboard/events/${event.id}/edit`}
        label="Edit event"
        extraLinks={[
          ...(venue ? [{ href: `/dashboard/venues/${venue.id}`, label: "Place dashboard" }] : []),
          { href: `/admin/events?q=${encodeURIComponent(event.title.slice(0, 30))}`, label: "🔎 All events" },
        ]}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {heroPhoto && (
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-[600px] -z-10 opacity-30 blur-3xl"
          style={{ backgroundImage: `url(${heroPhoto})`, backgroundSize: "cover", backgroundPosition: "center" }}
        />
      )}

      <div className="container-page py-8 sm:py-12 max-w-5xl">
        <Link href={`/${citySlug}`} className="inline-flex items-center gap-1 text-sm text-buzz-mute hover:text-buzz-accent transition mb-6">
          ← Back to {eventCity.name}
        </Link>

        {/* Festival affiliation banner — only renders when this event is
            linked to a published festival. Shows a "happening now" pulse
            when today falls inside the festival's date window. */}
        <FestivalBanner festival={(event as any).festival} />

        <div className="grid md:grid-cols-[minmax(0,1fr)_1.2fr] gap-8 md:gap-10 items-start">
          <div className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-buzz-surface border border-buzz-border shadow-2xl shadow-buzz-accent/10">
            <EventHeroImage
              imageUrl={heroPhoto}
              title={event.title}
              venueName={placeName}
              fallbackIcon={fallbackIcon}
            />
            {event.cancelled && (
              <div className="absolute inset-0 bg-black/70 grid place-items-center">
                <span className="font-display text-5xl uppercase text-rose-500 rotate-[-8deg] tracking-wider">Cancelled</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-5">
            <div>
              <div className="inline-flex items-center gap-2 chip-accent text-sm">
                {formatEventTime(event.start_time, event.end_time)}
              </div>
            </div>

            <div className="flex items-start justify-between gap-3 flex-wrap">
              <h1 className="h-display text-5xl sm:text-6xl flex-1 min-w-0">{event.title}</h1>
              {/* Prominent favourite button next to title — visible at top
                  on mobile rather than tucked below at the action row. */}
              <div className="shrink-0 sm:mt-2">
                <FavouriteButton
                  targetType="event"
                  targetId={event.id}
                  initialFavourited={eventFavourited}
                  signedIn={!!viewer}
                />
              </div>
            </div>

            <div className="text-lg">
              <span className="text-buzz-mute">at </span>
              {venue ? (
                <Link href={`/${citySlug}/venues/${venue.slug}`} className="text-buzz-accent hover:text-buzz-accent2 font-semibold">
                  {venue.name}
                </Link>
              ) : (
                <span className="font-semibold text-buzz-text">{placeName}</span>
              )}
            </div>

            {(venue?.address || (event as any).location_name) && (
              <div className="text-sm text-buzz-mute">
                📍 {venue?.address ? `${venue.address}${venue.postcode ? `, ${venue.postcode}` : ""}` : (event as any).location_name}
              </div>
            )}

            {artists.length > 0 && (
              <div>
                <div className="eyebrow text-[10px] mb-1.5">Featuring</div>
                <div className="flex flex-wrap gap-1.5">
                  {artists.map((a: any) => (
                    <Link key={a.id} href={`/artists/${a.slug}`} className="chip-accent hover:bg-buzz-accent2 transition">
                      {a.name} →
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {organisers.length > 0 && (
              <div>
                <div className="eyebrow text-[10px] mb-1.5">Organised by</div>
                <div className="flex flex-wrap gap-1.5">
                  {organisers.map((o: any) => (
                    <Link
                      key={o.id}
                      href={`/organisers/${o.slug}`}
                      className="chip hover:border-buzz-accent transition"
                    >
                      📋 {o.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {genres.map((g: any) => <span key={g.id} className="chip">{g.name}</span>)}
              </div>
            )}

            {event.cover_charge && (
              <div className="card p-4">
                <div className="eyebrow text-[10px] mb-1">Entry</div>
                <div className="text-2xl font-display">{event.cover_charge}</div>
              </div>
            )}

            {event.description && (
              <div className="card p-5">
                <div className="eyebrow text-[10px] mb-2">About</div>
                <p className="whitespace-pre-line text-buzz-text/90 leading-relaxed">{event.description}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-3 mt-2">
              {event.ticket_url && (
                <a href={event.ticket_url} target="_blank" rel="noreferrer" className="btn-primary btn-lg">Get tickets →</a>
              )}
              <a href={`/api/calendar/${event.id}`} className="btn-secondary btn-lg">📅 Add to calendar</a>
              {venue && (
                <Link href={`/${citySlug}/venues/${venue.slug}`} className="btn-secondary btn-lg">Place info</Link>
              )}
              <FavouriteButton
                targetType="event"
                targetId={event.id}
                initialFavourited={eventFavourited}
                signedIn={!!viewer}
              />
            </div>

            <div className="pt-3 border-t border-buzz-border/50">
              <ShareButtons url={`${siteUrl}/${citySlug}/events/${event.id}`} title={`${event.title} at ${placeName}`} />
            </div>

            {/* Admin-only widget — renders nothing for non-admins. */}
            <AdminExpireEventButton
              eventId={event.id}
              eventTitle={event.title}
              hasEndTime={!!event.end_time}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// Banner shown on event pages when the event belongs to a festival.
// Renders only when the festival is published — unpublished festivals
// shouldn't leak through event pages. Adds a subtle "Happening now"
// indicator when today falls inside the festival window.
function FestivalBanner({
  festival,
}: {
  festival: {
    id: string;
    name: string;
    slug: string;
    start_date: string;
    end_date: string;
    primary_color: string | null;
    logo_url: string | null;
    published: boolean;
  } | null;
}) {
  if (!festival || !festival.published) return null;

  const accent = festival.primary_color || "#e91e63";
  // London-local "today" as YYYY-MM-DD for date comparison. festivals.start_
  // / end_date are date columns (no time) so string comparison is correct.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const isHappeningNow =
    today >= festival.start_date && today <= festival.end_date;

  return (
    <Link
      href={`/festivals/${festival.slug}`}
      className="block mb-6 rounded-xl border px-4 py-3 hover:opacity-90 transition"
      style={{ borderColor: `${accent}66`, background: `${accent}14` }}
    >
      <div className="flex items-center gap-3">
        {festival.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={festival.logo_url}
            alt={festival.name}
            className="h-10 w-10 rounded-md object-contain bg-white/5 p-1 shrink-0"
            loading="lazy"
          />
        ) : (
          <div
            className="h-10 w-10 rounded-md grid place-items-center text-lg shrink-0"
            style={{ background: `${accent}33`, color: accent }}
          >
            🎪
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-buzz-mute flex items-center gap-2">
            <span>Part of</span>
            {isHappeningNow && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase"
                style={{ background: accent, color: "black" }}
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
                Happening now
              </span>
            )}
          </div>
          <div className="font-display text-lg truncate" style={{ color: accent }}>
            {festival.name}
          </div>
        </div>
        <span className="text-xs text-buzz-mute hover:text-buzz-text shrink-0">
          View festival →
        </span>
      </div>
    </Link>
  );
}
