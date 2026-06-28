import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import FestivalLandingClient from "./FestivalLandingClient";
import AdminEditBar from "@/components/AdminEditBar";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = createServiceClient();
  const { data: festival } = await sb
    .from("festivals")
    .select("name, tagline, hero_image_url, published")
    .eq("slug", slug)
    .maybeSingle();
  if (!festival || !festival.published) return { title: "Festival — The Buzz Guide" };
  return {
    title: `${festival.name} — The Buzz Guide`,
    description: festival.tagline ?? `${festival.name} listings on The Buzz Guide`,
    openGraph: festival.hero_image_url ? { images: [festival.hero_image_url] } : undefined,
  };
}

export default async function FestivalPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { slug } = await params;
  const { preview } = await searchParams;
  const sb = createServiceClient();

  // Two access paths: published (public) OR a valid preview token. The token
  // is set on the festival row by the admin and can be sent to prospective
  // festival organisers as a sneak-peek of their page before they go live.
  const { data: festival } = await sb
    .from("festivals")
    .select("id, name, slug, start_date, end_date, hero_image_url, hero_image_position, hero_image_opacity, hero_image_blur, map_image_url, primary_color, sponsor_text, sponsor_name, sponsor_logo_url, sponsor_url, ticket_url, contact_email, accepting_artists, description, tagline, act_count_label, venue_count_label, layout_mode, programme_content, published, preview_token")
    .eq("slug", slug)
    .maybeSingle();
  if (!festival) notFound();

  // Headline sponsor — standalone, owned by the festival admin. Used to be
  // a FK to the shared sponsors table; that was wrong because festival
  // sponsors are typically arranged by the festival organiser (e.g. GoFibre
  // for MoFest) and have no relationship to Buzz's own advertising
  // programme. Now stored as plain columns on the festival.
  const sponsorName = (festival.sponsor_name ?? "").trim();
  const sponsor = sponsorName.length > 0
    ? {
        name: sponsorName,
        logo_url: festival.sponsor_logo_url ?? null,
        url: (festival.sponsor_url ?? "").trim() || null,
      }
    : null;
  const isPreview = !festival.published && preview && preview === festival.preview_token;
  if (!festival.published && !isPreview) notFound();

  // Linked venues with city + cover photo
  const { data: venueLinks } = await sb
    .from("festival_venues")
    .select("sort_order, venues(id, name, slug, logo_url, cover_photo_url, latitude, longitude, approved, city:cities(name, slug))")
    .eq("festival_id", festival.id)
    .order("sort_order");
  const venues = (venueLinks ?? [])
    .map((r: any) => r.venues)
    .filter((v: any) => v && v.approved);

  // Events at festival venues during the festival window
  const venueIds = venues.map((v: any) => v.id);
  let events: any[] = [];
  if (venueIds.length > 0) {
    const startIso = `${festival.start_date}T00:00:00Z`;
    const endIso = `${festival.end_date}T23:59:59Z`;
    const { data: ev } = await sb
      .from("events")
      .select(`
        id, title, start_time, end_time, image_url, venue_id, cover_charge,
        venue:venues(name, slug, city:cities(slug)),
        event_artists(artist:artists(id, name, slug, image_url))
      `)
      .in("venue_id", venueIds)
      .gte("start_time", startIso)
      .lte("start_time", endIso)
      .or("status.is.null,status.eq.approved")
      .order("start_time");
    events = (ev ?? []).map((e: any) => ({
      ...e,
      artists: (e.event_artists ?? [])
        .map((ea: any) => ea.artist)
        .filter(Boolean),
    }));
  }

  // Lineup count per venue
  const lineupByVenue = new Map<string, number>();
  for (const e of events) {
    lineupByVenue.set(e.venue_id, (lineupByVenue.get(e.venue_id) ?? 0) + 1);
  }

  // Signed-in user's artist favourites — used to seed the heart buttons
  // and power the "My picks" tab. Uses the cookie-auth client so RLS
  // applies (favourites are private to each user).
  let myArtistFavouriteIds: string[] = [];
  let signedIn = false;
  try {
    const userSb = await createClient();
    const { data: { user } } = await userSb.auth.getUser();
    if (user) {
      signedIn = true;
      // Pull just the artist favourites — we don't need the others here.
      // Small per-user set, cheap to fetch.
      const { data: favs } = await userSb
        .from("favourites")
        .select("target_id")
        .eq("user_id", user.id)
        .eq("target_type", "artist");
      myArtistFavouriteIds = (favs ?? []).map((r: any) => r.target_id as string);
    }
  } catch { /* logged-out / cookie-less = empty favourites, no big deal */ }

  // Typed-in lineup (sql/056). Pull the linked artist + time + stage.
  // Sorted chronologically — NULLS LAST so TBA acts trail the list.
  const { data: lineupRows } = await sb
    .from("festival_lineup")
    .select("id, performance_time, stage, artist:artists(id, name, slug, image_url)")
    .eq("festival_id", festival.id)
    .order("performance_time", { ascending: true, nullsFirst: false });

  // Extra sponsors for the "With thanks to" grid below the headline
  // sponsor card (sql/062). NULL/empty list = grid is hidden entirely.
  const { data: sponsorRows } = await sb
    .from("festival_sponsors")
    .select("id, name, logo_url, url, sort_order")
    .eq("festival_id", festival.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const extraSponsors = (sponsorRows ?? []).map((r: any) => ({
    id: r.id as string,
    name: r.name as string,
    logo_url: (r.logo_url as string | null) ?? null,
    url: (r.url as string | null) ?? null,
  }));
  const lineup = (lineupRows ?? []).map((r: any) => ({
    id: r.id,
    performance_time: r.performance_time as string | null,
    stage: (r.stage as string | null) ?? null,
    artist: {
      id: r.artist?.id as string,
      name: r.artist?.name as string,
      slug: r.artist?.slug as string,
      image_url: (r.artist?.image_url as string | null) ?? null,
    },
  })).filter((r) => r.artist.id);

  return (
    <>
      <AdminEditBar
        editHref={`/admin/festivals/${festival.id}`}
        label="Edit festival"
      />
      {isPreview && (
        <div className="bg-amber-500/15 border-b border-amber-500/40 text-amber-300 text-center text-xs sm:text-sm py-2 px-4">
          🔒 <strong>Preview mode</strong> — this page isn't publicly listed yet. Anyone with this private link can view it.
        </div>
      )}
      <FestivalLandingClient
        festival={festival}
        venues={venues.map((v: any) => ({ ...v, eventCount: lineupByVenue.get(v.id) ?? 0 }))}
        events={events}
        sponsor={sponsor}
        extraSponsors={extraSponsors}
        lineup={lineup}
        myArtistFavouriteIds={myArtistFavouriteIds}
        signedIn={signedIn}
      />
    </>
  );
}
