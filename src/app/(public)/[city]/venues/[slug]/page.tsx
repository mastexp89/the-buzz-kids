import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import SmartBackLink from "@/components/SmartBackLink";
import GoogleRating from "@/components/GoogleRating";
import SuggestEditButton from "@/components/SuggestEditButton";
import { createClient } from "@/lib/supabase/server";
import VenueEventsList from "@/components/VenueEventsList";
import ShareButtons from "@/components/ShareButtons";
import { DistancePill } from "@/components/NearMeButton";
import { SOCIAL_ICON_MAP } from "@/components/SocialIcons";
import { effectiveEndTime, formatFestivalDateRange } from "@/lib/utils";
import type { EventWithVenue } from "@/lib/types";
import { trackPageView } from "@/lib/track";
import FavouriteButton from "@/components/FavouriteButton";
import { isFavourited } from "@/lib/favourites";
import TrackedLink from "@/components/TrackedLink";
import AdminEditBar from "@/components/AdminEditBar";
import VenueGallery from "@/components/VenueGallery";
import { AccessibilityBadges } from "@/components/AccessibilityBadges";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ city: string; slug: string }> };

export async function generateMetadata({ params }: Props) {
  const supabase = await createClient();
  const { slug, city } = await params;
  const { data: v } = await supabase.from("venues").select("name, description, image_url").eq("slug", slug).single();
  if (!v) return {};
  return {
    title: `${v.name} — The Buzz Kids`,
    description: v.description?.slice(0, 160) ?? `What's on at ${v.name}.`,
    alternates: { canonical: `/${city}/venues/${slug}` },
    openGraph: {
      title: `${v.name} — Family day out on The Buzz Kids`,
      images: v.image_url ? [v.image_url] : [],
    },
  };
}

const SOCIAL_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  twitter: "X / Twitter",
  tiktok: "TikTok",
  spotify: "Spotify",
  youtube: "YouTube",
  website: "Website",
};

export default async function VenuePage({ params }: Props) {
  const supabase = await createClient();
  const { slug, city: citySlug } = await params;
  const { data: venue } = await supabase
    .from("venues")
    .select(`*, city:cities!inner(*)`)
    .eq("slug", slug)
    .maybeSingle();

  // Slug not found — check if it was renamed and 301 to the new URL
  if (!venue) {
    const { data: redirectRow } = await supabase
      .from("slug_redirects")
      .select("new_slug")
      .eq("resource_type", "venue")
      .eq("city_slug", citySlug)
      .eq("old_slug", slug)
      .maybeSingle();
    if (redirectRow?.new_slug) redirect(`/${citySlug}/venues/${redirectRow.new_slug}`);
    notFound();
  }
  if ((venue.city as any).slug !== citySlug) notFound();
  if (!venue.approved) notFound();

  // Track the view (fire-and-forget, bot-filtered).
  trackPageView({ venueId: venue.id, source: "venue_page" });

  // Initial favourite state for the heart button
  const { data: { user: viewer } } = await supabase.auth.getUser();
  const venueFavourited = viewer ? await isFavourited("venue", venue.id) : false;

  // Is the viewer an admin? Used to show an inline "Edit venue" button in the
  // header (there's also the floating AdminEditBar, but this one is obvious).
  let viewerIsAdmin = false;
  if (viewer) {
    const { data: prof } = await supabase.from("profiles").select("role").eq("id", viewer.id).maybeSingle();
    viewerIsAdmin = prof?.role === "admin";
  }

  // Fetch everything still live at this venue: future one-offs, multi-day
  // runs still going (end_date), and recurring series that haven't finished.
  // The old start_time-only filter hid this venue's ongoing exhibitions and
  // weekly clubs once their first date passed.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayLocal = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const { data: rawEvents } = await supabase
    .from("events")
    .select(`*, venue:venues!inner(*, city:cities!inner(*)), event_genres ( genre:genres(*) )`)
    .eq("venue_id", venue.id)
    .or(
      `start_time.gte.${startOfToday.toISOString()},end_time.gte.${startOfToday.toISOString()},` +
      `end_date.gte.${todayLocal},recurrence_until.gte.${todayLocal},` +
      `and(recurrence_pattern.not.is.null,recurrence_until.is.null)`,
    )
    .eq("cancelled", false)
    .eq("status", "approved")
    .order("start_time", { ascending: true })
    .limit(60);

  const nowDate = new Date();
  const events: EventWithVenue[] = (rawEvents ?? [])
    .filter((e: any) => {
      // Ongoing multi-day run — live until its last day ends.
      if (e.end_date && e.end_date >= todayLocal) return true;
      // Live recurring series (open-ended, or until a future date).
      if (e.recurrence_pattern && (!e.recurrence_until || e.recurrence_until >= todayLocal)) return true;
      // One-offs: fall back to venue closing time when end_time isn't set.
      return effectiveEndTime(e, e.venue).getTime() > nowDate.getTime();
    })
    .map((e: any) => ({
      ...e,
      genres: (e.event_genres ?? []).map((eg: any) => eg.genre).filter(Boolean),
    }));

  const cityName = (venue.city as any).name;
  const gallery: string[] = venue.gallery_image_urls ?? [];

  // Hero photo for the top of the page. Prefer an organiser/own photo; fall
  // back to the one pulled from Google Places (which needs an attribution).
  const ownHeroPhoto =
    (venue as any).cover_photo_url || venue.image_url || gallery[0] || null;
  const heroPhoto = ownHeroPhoto || (venue as any).google_photo_url || null;
  const heroIsGoogle = !ownHeroPhoto && !!(venue as any).google_photo_url;

  // Live festivals this venue is taking part in. RLS hides unpublished
  // festivals automatically (sql/036), so we only need to filter on
  // end_date to drop any festival that has finished. As soon as end_date
  // passes, the banner disappears — no manual cleanup required.
  const todayLondonYmd = new Date().toLocaleDateString("en-CA", {
    timeZone: "Europe/London",
  });
  const { data: festivalLinks } = await supabase
    .from("festival_venues")
    .select(
      "festival:festivals!inner(id, name, slug, start_date, end_date, primary_color)",
    )
    .eq("venue_id", venue.id);
  const liveFestivals: Array<{
    id: string;
    name: string;
    slug: string;
    start_date: string;
    end_date: string;
    primary_color: string | null;
  }> = (festivalLinks ?? [])
    .map((l: any) => l.festival)
    .filter((f: any) => f && f.end_date >= todayLondonYmd)
    .sort((a: any, b: any) => a.start_date.localeCompare(b.start_date));

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thebuzzguide.co.uk";
  const sameAs = [venue.website, venue.instagram, venue.facebook, venue.twitter, venue.tiktok, venue.spotify, venue.youtube].filter(Boolean);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: venue.name,
    description: venue.description ?? `Family-friendly place in ${cityName}`,
    url: `${siteUrl}/${citySlug}/venues/${venue.slug}`,
    image: venue.image_url ?? venue.logo_url ?? undefined,
    telephone: venue.phone ?? undefined,
    email: venue.email ?? undefined,
    sameAs: sameAs.length ? sameAs : undefined,
    address: {
      "@type": "PostalAddress",
      streetAddress: venue.address ?? undefined,
      postalCode: venue.postcode ?? undefined,
      addressLocality: cityName,
      addressCountry: "GB",
    },
  };

  const socialLinks = [
    { key: "website", url: venue.website },
    { key: "instagram", url: venue.instagram },
    { key: "facebook", url: venue.facebook },
    { key: "twitter", url: venue.twitter },
    { key: "tiktok", url: venue.tiktok },
    { key: "spotify", url: venue.spotify },
    { key: "youtube", url: venue.youtube },
  ].filter((s) => s.url);

  return (
    <div>
      <AdminEditBar
        editHref={`/dashboard/venues/${venue.id}/edit`}
        label="Edit venue"
        extraLinks={[
          { href: `/dashboard/venues/${venue.id}`, label: "Venue dashboard" },
          { href: `/dashboard/venues/${venue.id}/events/new`, label: "+ Add event" },
          { href: `/dashboard/venues/${venue.id}/events/upload-poster`, label: "📸 Upload poster" },
        ]}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="container-page py-8 sm:py-10 max-w-5xl">
        <SmartBackLink fallbackHref={`/${citySlug}`} />

        {liveFestivals.length > 0 && (
          <div className="mt-5 flex flex-col gap-2">
            {liveFestivals.map((f) => (
              <FestivalBanner key={f.id} festival={f} />
            ))}
          </div>
        )}

        {heroPhoto && (
          <div className="mt-6 relative h-40 sm:h-56 rounded-2xl overflow-hidden border border-buzz-border bg-buzz-surface">
            {/* Fill the banner edge-to-edge (object-cover) so there are no
                blurred side-bars from portrait/narrow photos. Landscape venue
                photos — the common case from Google — sit in perfectly. */}
            <img
              src={heroPhoto}
              alt={venue.name}
              className="absolute inset-0 h-full w-full object-cover"
            />
            {heroIsGoogle && (venue as any).google_photo_attribution && (
              <span className="absolute bottom-1.5 right-2.5 text-[11px] text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
                {(venue as any).google_photo_attribution} · Google
              </span>
            )}
          </div>
        )}

        {venue.logo_url && (
          <div className="mt-6 -mb-2">
            <div
              className="w-20 h-20 rounded-2xl bg-buzz-surface border-2 border-buzz-bg shadow-2xl shadow-black/50"
              style={{ backgroundImage: `url(${venue.logo_url})`, backgroundSize: "contain", backgroundPosition: "center", backgroundRepeat: "no-repeat" }}
              aria-label={`${venue.name} logo`}
            />
          </div>
        )}

        <div className="mt-6 grid md:grid-cols-[2fr_1fr] gap-8 items-start">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <p className="eyebrow">{cityName} · Place</p>
              {viewerIsAdmin && (
                <Link
                  href={`/dashboard/venues/${venue.id}/edit`}
                  className="inline-flex items-center gap-1 shrink-0 text-xs font-semibold text-buzz-accent border border-buzz-accent/40 rounded-full px-3 py-1 hover:bg-buzz-accent/10 transition"
                >
                  ✏️ Edit venue
                </Link>
              )}
            </div>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <h1 className="h-display text-5xl sm:text-6xl flex-1 min-w-0">{venue.name}</h1>
              {/* Prominent favourite button — sits next to the title so it's
                  visible above the fold on mobile, not buried in the sidebar. */}
              <div className="shrink-0 sm:mt-2">
                <FavouriteButton
                  targetType="venue"
                  targetId={venue.id}
                  initialFavourited={venueFavourited}
                  signedIn={!!viewer}
                />
              </div>
            </div>
            <GoogleRating
              rating={(venue as any).google_rating}
              count={(venue as any).google_rating_count}
              placeId={(venue as any).google_place_id}
              name={venue.name}
            />
            {venue.description && (
              <p className="whitespace-pre-line text-buzz-text/90 leading-relaxed mt-2">{venue.description}</p>
            )}

            {/* Good to know — the kids details parents scan for. */}
            {(() => {
              const v = venue as any;
              const age = v.age_min == null && v.age_max == null ? null
                : v.age_min != null && v.age_max != null ? (v.age_min === v.age_max ? `Age ${v.age_min}` : `Ages ${v.age_min}–${v.age_max}`)
                : v.age_min != null ? `Ages ${v.age_min}+` : `Up to ${v.age_max}s`;
              const price = v.is_free ? "Free"
                : v.price_from != null ? `From £${Number(v.price_from) % 1 === 0 ? Number(v.price_from) : Number(v.price_from).toFixed(2)}`
                : (v.price_note || null);
              const setting = v.setting === "indoor" ? "Indoor" : v.setting === "outdoor" ? "Outdoor" : v.setting === "both" ? "Indoor & outdoor" : null;
              const hasAccess = Array.isArray(v.accessibility) && v.accessibility.length > 0;
              if (!age && !price && !setting && !v.booking_required && !hasAccess) return null;
              const Pill = ({ children }: { children: any }) => (
                <span className="inline-flex items-center rounded-full bg-buzz-surface border border-buzz-border px-3 py-1 text-sm font-medium">{children}</span>
              );
              return (
                <div className="card p-5 mt-6">
                  <p className="eyebrow text-[10px] mb-3">Good to know</p>
                  <div className="flex flex-wrap gap-2">
                    {age && <Pill>{age}</Pill>}
                    {setting && <Pill>{setting}</Pill>}
                    {price && (
                      <span className="inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold" style={{ background: v.is_free ? "#E6F6E0" : "#FFEDC2", color: v.is_free ? "#3B6D11" : "#854F0B" }}>{price}</span>
                    )}
                    {v.booking_required && <Pill>Booking needed</Pill>}
                  </div>
                  {hasAccess && (
                    <div className="mt-3">
                      <AccessibilityBadges items={v.accessibility} size="md" />
                    </div>
                  )}
                  {v.booking_url && (
                    <a href={v.booking_url} target="_blank" rel="noopener" className="btn-primary mt-4 inline-flex self-start">🎟️ Book / buy tickets →</a>
                  )}
                </div>
              );
            })()}

            {/* What's on — only when this place actually has dated activities. */}
            {events.length > 0 && (
              <section className="mt-6">
                <p className="eyebrow mb-2">What's on</p>
                <h2 className="h-display text-3xl sm:text-4xl mb-5">Coming up</h2>
                <VenueEventsList events={events} citySlug={citySlug} />
              </section>
            )}

            {/* Accuracy disclaimer — we don't run these places. */}
            <p className="text-xs text-buzz-mute mt-6 leading-relaxed">
              ℹ️ We gather this info from organisers and public sources, so prices, times and details
              can change. Please double-check {venue.website ? "the venue's own website" : "with the venue"} before you set off.
            </p>
            <div className="mt-3">
              <SuggestEditButton
                targetType="venue"
                targetId={venue.id}
                targetName={venue.name}
                citySlug={citySlug}
              />
            </div>
          </div>
          <aside className="card p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="eyebrow text-[10px]">Find it</div>
              <DistancePill lat={(venue as any).latitude} lng={(venue as any).longitude} />
            </div>
            {venue.address && (
              <div className="text-sm leading-relaxed">
                {venue.address}<br />
                {venue.postcode && <span className="text-buzz-mute">{venue.postcode}</span>}
              </div>
            )}
            <div className="flex flex-col gap-2 mt-2">
              {venue.phone && (
                <TrackedLink
                  href={`tel:${venue.phone}`}
                  kind="click_phone"
                  venueId={venue.id}
                  className="btn-secondary"
                >
                  📞 {venue.phone}
                </TrackedLink>
              )}
              {venue.address && (
                <TrackedLink
                  href={`https://maps.google.com/?q=${encodeURIComponent(`${venue.name} ${venue.address} ${venue.postcode ?? ""}`)}`}
                  kind="click_maps"
                  venueId={venue.id}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary"
                >
                  📍 Open in Maps
                </TrackedLink>
              )}
              {venue.website && (
                <a href={venue.website} target="_blank" rel="noopener" className="btn-secondary">🌐 Visit website</a>
              )}
            </div>

            {((venue as any).opening_hours_json || venue.opening_hours) && (
              <div className="mt-4 pt-4 border-t border-buzz-border/60">
                <div className="eyebrow text-[10px] mb-2">Opening hours</div>
                <pre className="text-sm whitespace-pre-wrap font-sans text-buzz-text/90">
                  {(() => {
                    const json = (venue as any).opening_hours_json;
                    if (json && Object.keys(json).length > 0) {
                      const DAYS = [
                        ["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"],
                        ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"],
                      ] as const;
                      const fmt = (s?: string) => {
                        if (!s) return "—";
                        const m = /^(\d{1,2}):(\d{2})$/.exec(s);
                        if (!m) return s;
                        const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
                        const ampm = h >= 12 ? "pm" : "am";
                        const h12 = h % 12 === 0 ? 12 : h % 12;
                        return min === 0 ? `${h12}${ampm}` : `${h12}:${String(min).padStart(2, "0")}${ampm}`;
                      };
                      return DAYS
                        .map(([k, label]) => {
                          const d = json[k];
                          if (!d) return null;
                          if (d.closed) return `${label}: Closed`;
                          if (d.open === "00:00" && d.close === "23:59") return `${label}: Open 24 hrs`;
                          if (d.open && d.close) return `${label}: ${fmt(d.open)} – ${fmt(d.close)}`;
                          return null;
                        })
                        .filter(Boolean)
                        .join("\n");
                    }
                    return venue.opening_hours;
                  })()}
                </pre>
              </div>
            )}

            {gallery.length > 0 && (
              <div className="mt-4 pt-4 border-t border-buzz-border/60">
                <div className="eyebrow text-[10px] mb-2">Inside the venue</div>
                <VenueGallery images={gallery} inlineCount={6} compact />
              </div>
            )}

            {socialLinks.length > 0 && (
              <div className="mt-4 pt-4 border-t border-buzz-border/60">
                <div className="eyebrow text-[10px] mb-2">Follow them</div>
                <div className="flex flex-wrap gap-1.5">
                  {socialLinks.map(({ key, url }) => {
                    const Icon = SOCIAL_ICON_MAP[key];
                    return (
                      <TrackedLink
                        key={key}
                        href={url as string}
                        kind={`click_${key}`}
                        venueId={venue.id}
                        target="_blank"
                        rel="noreferrer"
                        ariaLabel={SOCIAL_LABELS[key]}
                        title={SOCIAL_LABELS[key]}
                        className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-buzz-card border border-buzz-border hover:border-buzz-accent hover:text-buzz-accent transition"
                      >
                        {Icon ? <Icon size={16} /> : key.charAt(0).toUpperCase()}
                      </TrackedLink>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-buzz-border/50 mt-2 flex flex-wrap items-center gap-3">
              <FavouriteButton
                targetType="venue"
                targetId={venue.id}
                initialFavourited={venueFavourited}
                signedIn={!!viewer}
              />
              <div className="ml-auto">
                <ShareButtons url={`${siteUrl}/${citySlug}/venues/${venue.slug}`} title={venue.name} size="sm" />
              </div>
            </div>
          </aside>
        </div>

        {/* Owner self-service accounts are switched off — businesses reach us
            via the "I run this place" tick on Suggest an edit (above), which
            lands in the admin queue. The old "Claim this listing" flow is kept
            in the codebase but no longer surfaced. */}

        {/* On-site reviews retired (2026-07-08) — Google ratings cover social
            proof. Components kept dormant in the codebase; restore by
            re-adding <ReviewsSection venueId venueName /> here. */}
      </div>
    </div>
  );
}

// Festival participation banner shown at the top of the venue page when
// the venue is linked to one or more festivals whose end_date is today
// or later. Auto-disappears the day after the festival finishes — no
// manual cleanup needed.
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
  };
}) {
  const accent = festival.primary_color || "#e91e63";
  const dateRange = formatFestivalDateRange(festival.start_date, festival.end_date);
  return (
    <Link
      href={`/festivals/${festival.slug}`}
      className="card p-3 sm:p-4 flex items-center gap-3 hover:opacity-90 transition group"
      style={{ borderColor: `${accent}66`, background: `${accent}10` }}
    >
      <div
        className="shrink-0 w-10 h-10 rounded-full grid place-items-center text-lg"
        style={{ background: `${accent}30`, color: accent }}
        aria-hidden
      >
        🎵
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider" style={{ color: accent }}>
          Taking part in
        </div>
        <div className="font-display uppercase text-lg sm:text-xl truncate leading-tight">
          {festival.name}
        </div>
        <div className="text-xs text-buzz-mute mt-0.5">{dateRange}</div>
      </div>
      <span
        className="shrink-0 text-sm font-medium hidden sm:inline-flex items-center gap-1 group-hover:gap-2 transition-all"
        style={{ color: accent }}
      >
        View festival →
      </span>
    </Link>
  );
}

// formatFestivalDateRange now imported from @/lib/utils — includes
// ordinal suffixes (30 → 30th) that this local copy lacked.
