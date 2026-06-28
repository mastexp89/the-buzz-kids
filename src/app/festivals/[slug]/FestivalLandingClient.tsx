"use client";

// Public festival landing page (e.g. /festivals/dmf).
// Three sections: hero, venue grid (with map embedded), and event list.
// Tabs let the user toggle between venue browse and schedule view.

import Link from "next/link";
import dynamic from "next/dynamic";
import { Fragment, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import {
  formatEventTime,
  formatFestivalDateRange,
  formatDayShort,
  formatDayLong,
} from "@/lib/utils";
import FavouriteButton from "@/components/FavouriteButton";

// Leaflet doesn't SSR so the map gets a dynamic import + ssr:false
const CityMap = dynamic(() => import("@/components/CityMap"), { ssr: false });

type Festival = {
  id: string;
  name: string;
  slug: string;
  start_date: string;
  end_date: string;
  hero_image_url: string | null;
  hero_image_position: string | null;
  // 0.00–1.00. Controls how visible the blurred backdrop image is —
  // lower values mute it more, letting the title read cleanly over
  // busy festival posters. NULL on old rows = treat as 0.5 (old default).
  hero_image_opacity: number | null;
  // Blur amount in pixels (0–40). 0 = sharp cover photo, 24 = old
  // hard-coded heavy-blur look. NULL on old rows = 24.
  hero_image_blur: number | null;
  map_image_url: string | null;
  primary_color: string | null;
  sponsor_text: string | null;
  ticket_url: string | null;
  contact_email: string | null;
  accepting_artists: boolean;
  description: string | null;
  tagline: string | null;
  act_count_label: string | null;
  venue_count_label: string | null;
  // Layout: 'multi_venue' = default tabs (Schedule/Venues/Artists/Map/Picks).
  // 'programme' = single-park festivals like Bruce: shows a Programme tab
  // (long-form markdown content), hides Venues + Map tabs.
  layout_mode: "multi_venue" | "programme" | null;
  programme_content: string | null;
};

type Venue = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  cover_photo_url: string | null;
  latitude: number | null;
  longitude: number | null;
  city: { name: string; slug: string } | null;
  eventCount: number;
};

type EventArtist = {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
};

type EventLite = {
  id: string;
  title: string;
  start_time: string;
  end_time: string | null;
  image_url: string | null;
  venue_id: string;
  cover_charge: string | null;
  venue: { name: string; slug: string; city: { slug: string } | null } | null;
  artists?: EventArtist[];
};

type Tab = "venues" | "artists" | "schedule" | "map" | "picks" | "programme";

type Sponsor = {
  // Standalone festival sponsor (e.g. GoFibre for MoFest). NOT linked to
  // the Buzz sponsors table — just a name, logo and click-through URL set
  // by the festival admin.
  name: string;
  logo_url: string | null;
  url: string | null;
};

// Extra sponsors shown as a "With thanks to" grid below the headline
// sponsor card. Multiple rows from festival_sponsors (sql/062).
type ExtraSponsor = {
  id: string;
  name: string;
  logo_url: string | null;
  url: string | null;
};

// Typed-in lineup row — pairs an artist with a performance time + stage.
// Independent of event_artists; used for festivals where admins type the
// lineup directly (e.g. programme-mode festivals with no event rows).
type LineupRow = {
  id: string;
  performance_time: string | null; // ISO, null = TBA
  stage: string | null;
  artist: {
    id: string;
    name: string;
    slug: string;
    image_url: string | null;
  };
};

export default function FestivalLandingClient({
  festival,
  venues,
  events,
  sponsor,
  extraSponsors,
  lineup,
  myArtistFavouriteIds,
  signedIn,
}: {
  festival: Festival;
  venues: Venue[];
  events: EventLite[];
  sponsor: Sponsor | null;
  extraSponsors: ExtraSponsor[];
  lineup: LineupRow[];
  myArtistFavouriteIds: string[];
  signedIn: boolean;
}) {
  // Two layout modes:
  //  • multi_venue — the default. Tabs: Schedule / Venues / Artists / Map / Picks.
  //  • programme   — single-park festivals (Bruce-style). Tabs:
  //                  Programme / Schedule / Artists / Picks. No Venues, no Map.
  // The layout_mode flag is per-festival and admin-toggled. Defaults to
  // multi_venue if the column is null (every pre-existing festival row).
  const isProgrammeLayout = festival.layout_mode === "programme";

  // Default tab depends on layout:
  //   • multi-venue → Schedule (most users want "when's what on")
  //   • programme   → Programme (most users want the long-form rundown:
  //                   arenas, all-day attractions, travel info)
  const [tab, setTab] = useState<Tab>(isProgrammeLayout ? "programme" : "schedule");
  const [dayFilter, setDayFilter] = useState<"all" | string>("all");
  // Schedule view mode — list (chronological flat list, the original)
  // or grid (festival-programme-style: venues as columns, time down the
  // side, acts as blocks). Mobile collapses the grid to a per-venue
  // vertical stack inside the same component.
  const [scheduleView, setScheduleView] = useState<"list" | "grid">("list");

  // Set of artist ids the signed-in user has hearted, kept as React state
  // so the FavouriteButton can flip cards into "my picks" optimistically
  // without re-rendering the whole page.
  const [pickedArtistIds, setPickedArtistIds] = useState<Set<string>>(
    () => new Set(myArtistFavouriteIds),
  );
  function togglePick(artistId: string, on: boolean) {
    setPickedArtistIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(artistId); else next.delete(artistId);
      return next;
    });
  }

  // Events at this festival featuring at least one of the user's favourited
  // artists. Used by the "My picks" tab — a personal day-plan for the festival.
  const pickedEvents = useMemo(() => {
    if (pickedArtistIds.size === 0) return [];
    return events
      .filter((e) => (e.artists ?? []).some((a) => pickedArtistIds.has(a.id)))
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }, [events, pickedArtistIds]);

  // Venue ids that host at least one of the user's picked events. The Map tab
  // visually highlights these so a fan can see at a glance where their day
  // takes them.
  const pickedVenueIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of pickedEvents) s.add(e.venue_id);
    return s;
  }, [pickedEvents]);

  const accent = festival.primary_color || "#e91e63";

  // List of unique date strings (YYYY-MM-DD) for the day filter pills
  const dayOptions = useMemo(() => {
    const days = new Set<string>();
    for (const e of events) {
      days.add(e.start_time.slice(0, 10));
    }
    return Array.from(days).sort();
  }, [events]);

  const filteredEvents = useMemo(() => {
    if (dayFilter === "all") return events;
    return events.filter((e) => e.start_time.startsWith(dayFilter));
  }, [events, dayFilter]);

  // Acts = event-derived artists + typed-in lineup, deduplicated by
  // artist id so a band that appears in both sources isn't double-counted.
  const totalActs = (() => {
    const ids = new Set<string>();
    for (const e of events) for (const a of e.artists ?? []) ids.add(a.id);
    for (const r of lineup) ids.add(r.artist.id);
    return ids.size;
  })();
  const totalEvents = totalActs;
  const totalVenues = venues.length;
  // Days = end - start + 1, NOT unique event days (which would be 0 pre-lineup)
  const totalDays = (() => {
    const s = new Date(festival.start_date + "T00:00:00").getTime();
    const e = new Date(festival.end_date + "T00:00:00").getTime();
    if (Number.isNaN(s) || Number.isNaN(e)) return 1;
    return Math.max(1, Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1);
  })();
  // Display labels — admin-set string OR live count fallback
  const venueLabel = festival.venue_count_label ?? String(totalVenues);
  const actLabel = festival.act_count_label ?? String(totalEvents);
  const dayLabel = String(totalDays);

  return (
    <div className="min-h-screen">
      {/* Mobile-only: standalone clean poster block at the top.
          Designed festival posters (Bruce Festival, MoFest etc.) carry their
          own typography + key info. On a narrow viewport, overlaying our
          title + dates + stats on top of the same poster double-stacks the
          information and looks cluttered. So on mobile we show the poster
          unblurred + undimmed as its own block, and let the text section
          below stand on a plain dark background.
          Hidden on sm+ — desktop keeps the original blurred-backdrop
          treatment further down. */}
      {festival.hero_image_url && (
        <div className="sm:hidden border-b border-buzz-border bg-buzz-bg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={festival.hero_image_url}
            alt={festival.name}
            className="w-full h-auto block"
            style={{
              objectFit: "contain",
              objectPosition: festival.hero_image_position || "center",
            }}
          />
        </div>
      )}

      {/* Hero — dark theme, pink as accent only. Cover image (if any) renders
          as a heavily-blurred + dimmed colour texture behind the title. We
          tried showing the cover full-bleed AND an iTunes-style two-layer
          treatment — both competed with the title overlay for self-branded
          posters (MoFest etc.). Back to the original muted-backdrop. */}
      <section className="relative overflow-hidden border-b border-buzz-border bg-buzz-bg">
        {/* Background image: heavily blurred so even self-branded posters
            read as a textured backdrop, not a competing visual. Scaled up
            to hide the soft edges from the blur.
            Hidden on mobile — the mobile poster block above replaces this
            treatment because overlaying text on a posters-with-their-own-text
            looked cluttered on narrow viewports. */}
        {festival.hero_image_url && (() => {
          // Admin-controlled per-festival. NULLs on legacy rows fall back
          // to the previous hard-coded values so nothing changes visually
          // until the admin tweaks.
          //
          // Desktop (sm+) only: background-size: cover with a small scale to
          // hide the soft edges heavy blur introduces. The wider viewport
          // means cover doesn't usually crop anything meaningful.
          //
          // Heavy-blur (>=8px) needs scale(1.15); light blur only needs
          // scale(1.02) to mask sub-pixel rendering.
          const blurPx = festival.hero_image_blur ?? 24;
          const heroOpacity = festival.hero_image_opacity ?? 0.5;
          const scaleClass = blurPx >= 8 ? "scale-[1.15]" : "scale-[1.02]";
          return (
            <div
              aria-hidden
              className={`absolute inset-0 pointer-events-none bg-cover bg-no-repeat hidden sm:block ${scaleClass}`}
              style={{
                backgroundImage: `url(${festival.hero_image_url})`,
                backgroundPosition: festival.hero_image_position || "center",
                filter: `blur(${blurPx}px) saturate(1.2)`,
                opacity: heroOpacity,
              }}
            />
          );
        })()}
        {/* Dark scrim on top of the image so the title text reads cleanly.
            Desktop only — on mobile the text sits on the plain bg-buzz-bg
            already (no image behind it) so no scrim needed. */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none hidden sm:block"
          style={{
            background: "linear-gradient(180deg, rgba(10,10,15,0.55) 0%, rgba(10,10,15,0.85) 100%)",
          }}
        />
        {/* Subtle accent glow at the very top */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
        />
        <div
          aria-hidden
          className="absolute -top-32 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full opacity-20 blur-3xl pointer-events-none"
          style={{ background: accent }}
        />

        <div className="container-page py-12 sm:py-16 text-center relative">
          <Link
            href="/dundee"
            className="inline-block mb-6 text-xs uppercase tracking-wider text-buzz-mute hover:text-buzz-text transition"
          >
            ← The Buzz Guide
          </Link>
          <h1
            className="font-display text-5xl sm:text-7xl uppercase leading-[0.95]"
            style={{
              color: accent,
              // Soft drop-shadow keeps the title legible when the cover
              // image has its own large typography (e.g. festival posters
              // with date numerals behind the heading).
              textShadow: "0 2px 18px rgba(0,0,0,0.7), 0 0 6px rgba(0,0,0,0.5)",
            }}
          >
            {festival.name}
          </h1>
          {festival.tagline && (
            <p
              className="text-lg sm:text-xl mt-4 font-bold tracking-wide text-buzz-text"
              style={{ textShadow: "0 2px 10px rgba(0,0,0,0.65)" }}
            >
              {festival.tagline}
            </p>
          )}
          <div className="text-sm sm:text-base mt-6 font-medium text-buzz-mute">
            {formatFestivalDateRange(festival.start_date, festival.end_date)}
          </div>

          <div className="flex flex-wrap gap-3 justify-center mt-8">
            {/* Hide the Venues stat in programme mode — single-park festivals
                always read "0 VENUES" which looks like a broken page. */}
            {!isProgrammeLayout && (
              <Stat value={venueLabel} label="Venues" accent={accent} />
            )}
            <Stat value={actLabel} label="Acts" accent={accent} />
            <Stat value={dayLabel} label={totalDays === 1 ? "Day" : "Days"} accent={accent} />
          </div>

          {festival.ticket_url && (
            <a
              href={festival.ticket_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-8 px-6 py-3 rounded-lg font-bold text-sm uppercase tracking-wider transition text-black hover:opacity-90"
              style={{ background: accent }}
            >
              🎟️ Tickets
            </a>
          )}

          {festival.sponsor_text && (
            <p className="text-xs text-buzz-mute mt-10 uppercase tracking-wider">{festival.sponsor_text}</p>
          )}
        </div>
      </section>

      {/* Headline sponsor card — sits between the hero and the description so
          the advertiser gets prime real estate without crowding the hero
          itself. Only renders when an active sponsor is set. */}
      {sponsor && <SponsorCard sponsor={sponsor} accent={accent} />}

      {/* Extra sponsors grid (sql/062). Shown below the headline sponsor as
          a "With thanks to" wall of equal-size logos. Hidden entirely when
          there are no extras. */}
      {extraSponsors.length > 0 && (
        <ExtraSponsorsGrid sponsors={extraSponsors} />
      )}

      {/* About / description — sits above the tabs so it's the first thing a
          visitor reads. Renders the admin's plain-text blurb with paragraph
          breaks on blank lines + line breaks on single newlines. */}
      {festival.description && festival.description.trim().length > 0 && (
        <section className="border-b border-buzz-border bg-buzz-bg">
          <div className="container-page py-8 sm:py-10">
            <FestivalDescription text={festival.description} />
          </div>
        </section>
      )}

      {/* Tabs — order + visibility depends on layout mode.
          multi_venue: Schedule · Venues · Artists · Map · Picks
          programme:   Programme · Schedule · Artists · Picks
          (Programme comes first because it's the meat of single-park
          festivals; Schedule stays as a secondary view for music-zone
          gigs that have proper start_times). */}
      <nav className="sticky top-0 z-20 bg-buzz-bg border-b border-buzz-border">
        <div className="container-page flex gap-1 overflow-x-auto">
          {isProgrammeLayout && (
            <TabButton active={tab === "programme"} onClick={() => setTab("programme")} accent={accent}>Programme</TabButton>
          )}
          <TabButton active={tab === "schedule"} onClick={() => setTab("schedule")} accent={accent}>Schedule</TabButton>
          {!isProgrammeLayout && (
            <TabButton active={tab === "venues"} onClick={() => setTab("venues")} accent={accent}>Venues</TabButton>
          )}
          <TabButton active={tab === "artists"} onClick={() => setTab("artists")} accent={accent}>Artists</TabButton>
          {!isProgrammeLayout && (
            <TabButton active={tab === "map"} onClick={() => setTab("map")} accent={accent}>Map</TabButton>
          )}
          {/* My picks tab is only useful for signed-in fans — hide for anon
              to avoid teasing a feature they need to sign in to use. */}
          {signedIn && (
            <TabButton active={tab === "picks"} onClick={() => setTab("picks")} accent={accent}>
              ❤ My picks{pickedArtistIds.size > 0 ? ` (${pickedArtistIds.size})` : ""}
            </TabButton>
          )}
        </div>
      </nav>

      <div className="container-page py-8 sm:py-10">
        {/* Get involved CTA — visible on every tab, only when the festival has
            a contact email AND is still accepting artist submissions. Toggle
            it off from the admin form when the lineup is full. */}
        {festival.contact_email && festival.accepting_artists && (
          <GetInvolvedCard accent={accent} contactEmail={festival.contact_email} />
        )}


        {/* Day filter pills (used by Schedule + Map) + Schedule view toggle.
            View toggle only shows on Schedule, and only when there's more
            than one venue's worth of events (the grid view needs at least
            two columns to be interesting). */}
        {(tab === "schedule" || tab === "map") && (dayOptions.length > 1 || tab === "schedule") && (
          <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
            {dayOptions.length > 1 ? (
              <div className="flex gap-2 flex-wrap">
                <DayPill active={dayFilter === "all"} onClick={() => setDayFilter("all")} accent={accent}>All days</DayPill>
                {dayOptions.map((d) => (
                  <DayPill key={d} active={dayFilter === d} onClick={() => setDayFilter(d)} accent={accent}>
                    {formatDayShort(d)}
                  </DayPill>
                ))}
              </div>
            ) : (
              <div />
            )}
            {tab === "schedule" && distinctEventVenueCount(filteredEvents) >= 2 && (
              <div className="flex gap-1 bg-buzz-card border border-buzz-border rounded-lg p-1">
                <ViewToggleButton
                  active={scheduleView === "list"}
                  onClick={() => setScheduleView("list")}
                  accent={accent}
                >
                  ☰ List
                </ViewToggleButton>
                <ViewToggleButton
                  active={scheduleView === "grid"}
                  onClick={() => setScheduleView("grid")}
                  accent={accent}
                >
                  ▦ Grid
                </ViewToggleButton>
              </div>
            )}
          </div>
        )}

        {tab === "venues" && (
          <VenueGrid venues={venues} accent={accent} />
        )}

        {tab === "artists" && (
          <ArtistsGrid
            events={events}
            lineup={lineup}
            festivalDateRange={{ start: festival.start_date, end: festival.end_date }}
            accent={accent}
            // Hide the "Want to play?" empty-state CTA when the festival is
            // no longer accepting submissions, even if a contact email is set.
            contactEmail={festival.accepting_artists ? festival.contact_email : null}
            pickedArtistIds={pickedArtistIds}
            signedIn={signedIn}
            onTogglePick={togglePick}
          />
        )}

        {tab === "picks" && (
          <PicksTab
            events={pickedEvents}
            venues={venues}
            accent={accent}
            pickedArtistIds={pickedArtistIds}
            signedIn={signedIn}
            onTogglePick={togglePick}
          />
        )}

        {tab === "schedule" && scheduleView === "list" && (
          <ScheduleList
            events={filteredEvents}
            lineup={lineup}
            festivalDateRange={{ start: festival.start_date, end: festival.end_date }}
            accent={accent}
            // Same "lineup full" gate as the Artists empty state.
            contactEmail={festival.accepting_artists ? festival.contact_email : null}
          />
        )}

        {tab === "schedule" && scheduleView === "grid" && (
          <ScheduleGrid
            events={filteredEvents}
            venues={venues}
            accent={accent}
          />
        )}

        {tab === "programme" && (
          <ProgrammeTab
            markdown={festival.programme_content ?? ""}
            accent={accent}
          />
        )}

        {tab === "map" && (
          <>
            {/* Admin-uploaded illustrated site map — shown above the live
                venue map. Optional; only renders when set. */}
            {festival.map_image_url && (
              <div className="mb-8">
                <h3 className="eyebrow mb-3">Site map</h3>
                <div className="rounded-xl overflow-hidden bg-buzz-card border border-buzz-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={festival.map_image_url}
                    alt={`${festival.name} site map`}
                    className="w-full h-auto block"
                    loading="lazy"
                  />
                </div>
                <h3 className="eyebrow mt-8 mb-3">Venue locations</h3>
              </div>
            )}
            <FestivalMap venues={venues} highlightedVenueIds={pickedVenueIds} />
          </>
        )}
      </div>
    </div>
  );
}

// Heart that updates the parent's picked-set so the "My picks" tab count
// re-renders without a route refresh. Uses the existing FavouriteButton
// for the actual server call + sign-in redirect; the small wrapper
// component just intercepts the result to lift state.
function HeartOnCard({
  artistId,
  initialPicked,
  signedIn,
  onChange,
}: {
  artistId: string;
  initialPicked: boolean;
  signedIn: boolean;
  onChange: (artistId: string, on: boolean) => void;
}) {
  // We can't easily get FavouriteButton's after-state without forking it,
  // so we lift state pessimistically here: assume the toggle succeeded and
  // flip locally. Network failure will leave parent slightly out of sync
  // until next page load — acceptable, and the heart visual still rolls
  // back via FavouriteButton's own optimistic logic.
  return (
    <div
      onClick={(e) => {
        // Stop the parent Link's navigation
        e.preventDefault();
        e.stopPropagation();
        if (signedIn) onChange(artistId, !initialPicked);
      }}
    >
      <FavouriteButton
        targetType="artist"
        targetId={artistId}
        initialFavourited={initialPicked}
        signedIn={signedIn}
        size="sm"
        showLabel={false}
      />
    </div>
  );
}

// Headline sponsor card — sits between hero and description. Renders as a
// muted band with the sponsor logo + "Brought to you by" line. Clicks pass
// Standalone festival sponsor card — no Buzz click-tracking pipeline since
// the sponsor isn't a Buzz advertiser. Plain <a target=_blank> when a URL
// is set, plain div otherwise.
function SponsorCard({ sponsor, accent }: { sponsor: Sponsor; accent: string }) {
  const inner = (
    <div
      className="flex items-center gap-4 px-4 py-3 rounded-xl border max-w-3xl mx-auto bg-buzz-card"
      style={{ borderColor: `${accent}40` }}
    >
      {sponsor.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sponsor.logo_url}
          alt={sponsor.name}
          className="h-12 w-12 sm:h-14 sm:w-14 object-contain rounded-md bg-white/5 p-1"
          loading="lazy"
        />
      ) : (
        <div className="h-12 w-12 sm:h-14 sm:w-14 rounded-md bg-buzz-surface flex items-center justify-center font-bold" style={{ color: accent }}>
          {sponsor.name.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-buzz-mute">Event sponsor</div>
        <div className="font-display text-lg sm:text-xl truncate" style={{ color: accent }}>
          {sponsor.name}
        </div>
      </div>
      {sponsor.url && (
        <span className="text-xs text-buzz-mute hover:text-buzz-text">Visit →</span>
      )}
    </div>
  );
  if (sponsor.url) {
    return (
      <section className="border-b border-buzz-border bg-buzz-bg">
        <div className="container-page py-6">
          <a
            href={sponsor.url}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="block hover:opacity-90 transition"
          >
            {inner}
          </a>
        </div>
      </section>
    );
  }
  return (
    <section className="border-b border-buzz-border bg-buzz-bg">
      <div className="container-page py-6">{inner}</div>
    </section>
  );
}

// "With thanks to" grid — the long tail of smaller sponsors below the
// headline card. Equal-size logo tiles, lower visual weight than the
// headline card so the hierarchy is clear (one big sponsor + a wall of
// thanks). Hidden entirely when there are none.
function ExtraSponsorsGrid({ sponsors }: { sponsors: ExtraSponsor[] }) {
  return (
    <section className="border-b border-buzz-border bg-buzz-bg">
      <div className="container-page py-6">
        <div className="text-[10px] uppercase tracking-wider text-buzz-mute text-center mb-4">
          With thanks to
        </div>
        <ul className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 max-w-3xl mx-auto">
          {sponsors.map((s) => {
            const tile = s.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={s.logo_url}
                alt={s.name}
                className="h-16 w-auto sm:h-20 object-contain"
                loading="lazy"
              />
            ) : (
              <span className="text-sm font-medium text-buzz-text px-3 py-2">{s.name}</span>
            );
            return (
              <li
                key={s.id}
                title={s.name}
                className="flex items-center justify-center bg-buzz-card border border-buzz-border rounded-md p-3 sm:p-4 hover:border-buzz-accent transition"
              >
                {s.url ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer sponsored"
                    className="block"
                    aria-label={s.name}
                  >
                    {tile}
                  </a>
                ) : (
                  tile
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

// "My picks" tab content — the fan's personal festival day plan. Lists every
// event at this festival that features at least one hearted artist, in
// chronological order. Empty state walks the user through how to use it.
function PicksTab({
  events,
  venues,
  accent,
  pickedArtistIds,
  signedIn,
  onTogglePick,
}: {
  events: EventLite[];
  // Needed for walking-gap calculations between consecutive picks at
  // different venues. PickTab indexes into this by event.venue_id.
  venues: Venue[];
  accent: string;
  pickedArtistIds: Set<string>;
  signedIn: boolean;
  onTogglePick: (artistId: string, on: boolean) => void;
}) {
  const venuesById = useMemo(() => {
    const m = new Map<string, Venue>();
    for (const v of venues) m.set(v.id, v);
    return m;
  }, [venues]);

  if (pickedArtistIds.size === 0) {
    return (
      <div className="card p-10 text-center">
        <div className="text-5xl mb-3">❤</div>
        <div className="font-display text-3xl uppercase mb-2" style={{ color: accent }}>Heart your acts</div>
        <p className="text-buzz-mute max-w-md mx-auto text-sm">
          Tap the heart on any artist (Artists tab) and they&apos;ll show up here as your personal festival day plan — in time order, with venue + stage so you don&apos;t miss a thing.
        </p>
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div className="card p-10 text-center">
        <div className="text-5xl mb-3">🕒</div>
        <div className="font-display text-3xl uppercase mb-2" style={{ color: accent }}>Set times TBA</div>
        <p className="text-buzz-mute max-w-md mx-auto text-sm">
          You&apos;ve hearted {pickedArtistIds.size} act{pickedArtistIds.size === 1 ? "" : "s"} but no set times have been published yet. We&apos;ll fill this in as the schedule lands.
        </p>
      </div>
    );
  }
  // Group by calendar day (Europe/London) so a multi-day festival reads as
  // a per-day plan rather than one long list.
  const byDay = new Map<string, EventLite[]>();
  for (const e of events) {
    const day = new Date(e.start_time).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
    const list = byDay.get(day) ?? [];
    list.push(e);
    byDay.set(day, list);
  }
  // Sort each day's events by start time — required for the walking-gap
  // pills to land between the right pair of acts.
  for (const list of byDay.values()) {
    list.sort((a, b) => a.start_time.localeCompare(b.start_time));
  }
  const days = Array.from(byDay.keys()).sort();
  return (
    <div className="flex flex-col gap-8">
      {days.map((day) => {
        const dayEvents = byDay.get(day)!;
        return (
          <section key={day}>
            <h3 className="font-display text-2xl uppercase mb-3" style={{ color: accent }}>
              {formatDayLong(day)}
            </h3>
            <ul className="flex flex-col gap-2">
              {dayEvents.map((e, idx) => {
                const pickedArtists = (e.artists ?? []).filter((a) => pickedArtistIds.has(a.id));
                const prev = idx > 0 ? dayEvents[idx - 1] : null;
                // Compute the gap pill: walking time + free minutes
                // between the previous act's end and this act's start.
                const gap = prev
                  ? computeRouteGap(prev, e, venuesById)
                  : null;
                return (
                  <Fragment key={e.id}>
                    {gap && <RouteGapPill gap={gap} accent={accent} />}
                    <li className="card p-3 flex items-center gap-3">
                      <div className="text-xs font-bold uppercase tracking-wider min-w-[68px]" style={{ color: accent }}>
                        {formatEventTime(e.start_time, e.end_time ?? undefined)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <Link href={`/dundee/events/${e.id}`} className="font-medium text-sm hover:text-buzz-accent block truncate">
                          {pickedArtists.map((a) => a.name).join(" + ") || e.title}
                        </Link>
                        {e.venue?.name && (
                          <div className="text-[11px] text-buzz-mute truncate">
                            at <Link href={`/dundee/venues/${e.venue.slug}`} className="hover:text-buzz-text">{e.venue.name}</Link>
                          </div>
                        )}
                      </div>
                      {/* Per-row heart so the fan can drop an act without leaving the page */}
                      {pickedArtists.length === 1 && (
                        <HeartOnCard
                          artistId={pickedArtists[0].id}
                          initialPicked
                          signedIn={signedIn}
                          onChange={onTogglePick}
                        />
                      )}
                    </li>
                  </Fragment>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// Gap between two consecutive picked acts. Three flavours:
//   - sameVenue: 22:00 → 22:15, no walk needed
//   - walk:     22:00 → 22:15, ~6min walk to next venue
//   - clash:    next act starts BEFORE this one ends (overlap)
type RouteGap =
  | { kind: "sameVenue"; minutesFree: number; venueName: string }
  | {
      kind: "walk";
      minutesFree: number;
      walkMinutes: number;
      fromVenue: Venue;
      toVenue: Venue;
    }
  | { kind: "clash"; minutesOverlap: number };

function computeRouteGap(
  prev: EventLite,
  next: EventLite,
  venuesById: Map<string, Venue>,
): RouteGap | null {
  const prevEnd = prev.end_time
    ? new Date(prev.end_time).getTime()
    : new Date(prev.start_time).getTime() + 60 * 60_000;
  const nextStart = new Date(next.start_time).getTime();
  const freeMs = nextStart - prevEnd;
  const freeMin = Math.round(freeMs / 60_000);

  if (freeMs < 0) {
    return { kind: "clash", minutesOverlap: Math.abs(freeMin) };
  }

  // Same venue — no walking, just waiting between sets.
  if (prev.venue_id === next.venue_id) {
    // Don't bother rendering a gap pill for a tight transition (<10
    // mins) at the same venue — it's just the next set starting.
    if (freeMin < 10) return null;
    const venue = venuesById.get(prev.venue_id);
    return {
      kind: "sameVenue",
      minutesFree: freeMin,
      venueName: venue?.name ?? "the venue",
    };
  }

  // Different venues — compute the walk.
  const from = venuesById.get(prev.venue_id);
  const to = venuesById.get(next.venue_id);
  if (
    !from || !to ||
    from.latitude == null || from.longitude == null ||
    to.latitude == null || to.longitude == null
  ) {
    // Coords missing — still useful to flag "venue change"
    return from && to
      ? { kind: "walk", minutesFree: freeMin, walkMinutes: 0, fromVenue: from, toVenue: to }
      : null;
  }
  const km = haversineKm(
    { lat: from.latitude, lng: from.longitude },
    { lat: to.latitude, lng: to.longitude },
  );
  // 5 km/h walking pace. Floor at 1 min so "round the corner" still
  // surfaces something useful instead of "walk 0 min".
  const walkMinutes = Math.max(1, Math.round((km / 5) * 60));
  return { kind: "walk", minutesFree: freeMin, walkMinutes, fromVenue: from, toVenue: to };
}

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function RouteGapPill({ gap, accent }: { gap: RouteGap; accent: string }) {
  if (gap.kind === "clash") {
    return (
      <li className="ml-4 text-[11px] text-rose-400 flex items-center gap-2 my-1">
        ⚠ <span>Clash — overlaps by {gap.minutesOverlap}min</span>
      </li>
    );
  }
  if (gap.kind === "sameVenue") {
    return (
      <li className="ml-4 text-[11px] text-buzz-mute flex items-center gap-2 my-1">
        ⏱ <span>{gap.minutesFree}min wait at {gap.venueName}</span>
      </li>
    );
  }
  // walk
  const { fromVenue, toVenue, walkMinutes, minutesFree } = gap;
  // Deep link to Google Maps walking directions between the venues —
  // useful when a punter is mid-festival on a phone.
  const mapsHref = (() => {
    if (
      fromVenue.latitude == null || fromVenue.longitude == null ||
      toVenue.latitude == null || toVenue.longitude == null
    ) return null;
    const origin = `${fromVenue.latitude},${fromVenue.longitude}`;
    const dest = `${toVenue.latitude},${toVenue.longitude}`;
    return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=walking`;
  })();
  const tightTransition = walkMinutes > 0 && minutesFree < walkMinutes;
  return (
    <li
      className={
        "ml-4 text-[11px] flex items-center gap-2 my-1 " +
        (tightTransition ? "text-amber-400" : "text-buzz-mute")
      }
    >
      <span style={{ color: accent }}>↘</span>
      <span>
        {walkMinutes > 0
          ? `${walkMinutes}min walk to ${toVenue.name}`
          : `Change venue: ${toVenue.name}`}
        {minutesFree >= 0 && (
          <span className="text-buzz-mute ml-1">
            ({minutesFree}min{tightTransition ? " — tight!" : ""})
          </span>
        )}
      </span>
      {mapsHref && (
        <a
          href={mapsHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-buzz-mute hover:text-buzz-text underline"
        >
          directions ↗
        </a>
      )}
    </li>
  );
}

// Render the admin-written festival blurb as paragraphs. Splits on blank
// lines (paragraphs) and preserves single newlines within a paragraph via
// `whitespace-pre-line`. Plain text + emoji only — no markdown bold/links
// today; can be upgraded later if needed.
//
// Layout:
//  - Desktop (md+): CSS multi-column layout (columns-2) so long blurbs
//    read like a magazine spread rather than one tall scroll.
//  - Mobile: single column, collapsed to ~280px tall by default with a
//    "Read more" toggle so a long description doesn't push the tabs +
//    schedule miles below the fold.
// Programme tab — only rendered in programme layout mode (single-park
// festivals like Bruce). Long-form markdown content where the admin
// drops their arena timetables, all-day attractions, parking + travel
// notes, etc. Single column on purpose (the description above already
// does the two-column dance; a wall of schedule data reads better as
// one focused column).
function ProgrammeTab({ markdown, accent }: { markdown: string; accent: string }) {
  if (!markdown.trim()) {
    return (
      <div className="card p-8 text-center text-buzz-mute">
        <p className="text-sm">
          The festival programme isn&apos;t up yet — check back closer to the date.
        </p>
      </div>
    );
  }
  return (
    <div className="max-w-3xl mx-auto text-buzz-text text-base leading-relaxed">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={markdownComponents}>
        {markdown}
      </ReactMarkdown>
      {/* Accent rule under the programme — small visual punctuation so the
          tab content doesn't just trail off into the footer. */}
      <div
        aria-hidden
        className="mt-10 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
      />
    </div>
  );
}

function FestivalDescription({ text }: { text: string }) {
  if (!text || !text.trim()) return null;
  // Length-based collapse threshold — same idea as the old paragraph-
  // split version. Short blurbs (festivals that just have a tagline +
  // a paragraph) shouldn't show "Read more"; long ones (Bruce-style
  // multi-arena programmes) should collapse on mobile so the tabs
  // and schedule aren't pushed three screens down.
  const isLong = text.length > 600;
  return <CollapsibleDescription markdown={text} isLong={isLong} />;
}

// react-markdown component overrides — give each element our brand
// styling. Without these the elements render with browser defaults
// (small bullet points, bare blue links, no spacing). We don't enable
// raw HTML — react-markdown is safe-by-default, which is what we want
// since admins type the markdown by hand.
const markdownComponents = {
  p: (props: any) => (
    <p className="whitespace-pre-line break-inside-avoid mb-4 last:mb-0">{props.children}</p>
  ),
  strong: (props: any) => <strong className="font-bold text-buzz-text">{props.children}</strong>,
  em: (props: any) => <em className="italic">{props.children}</em>,
  h1: (props: any) => (
    <h2 className="font-display text-2xl uppercase mt-6 mb-2 first:mt-0 break-inside-avoid">{props.children}</h2>
  ),
  h2: (props: any) => (
    <h3 className="font-display text-xl uppercase mt-5 mb-2 first:mt-0 break-inside-avoid">{props.children}</h3>
  ),
  h3: (props: any) => (
    <h4 className="font-bold uppercase tracking-wide text-sm mt-4 mb-2 first:mt-0 break-inside-avoid">{props.children}</h4>
  ),
  ul: (props: any) => (
    <ul className="list-disc pl-5 mb-4 space-y-1 break-inside-avoid">{props.children}</ul>
  ),
  ol: (props: any) => (
    <ol className="list-decimal pl-5 mb-4 space-y-1 break-inside-avoid">{props.children}</ol>
  ),
  li: (props: any) => <li className="leading-relaxed">{props.children}</li>,
  a: (props: any) => (
    <a
      href={props.href}
      target={props.href?.startsWith("http") ? "_blank" : undefined}
      rel={props.href?.startsWith("http") ? "noreferrer" : undefined}
      className="text-buzz-accent underline hover:no-underline"
    >
      {props.children}
    </a>
  ),
  hr: () => <hr className="border-buzz-border my-6" />,
  blockquote: (props: any) => (
    <blockquote className="border-l-2 border-buzz-accent pl-4 italic my-4 break-inside-avoid">
      {props.children}
    </blockquote>
  ),
};

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

function CollapsibleDescription({
  markdown,
  isLong,
}: {
  markdown: string;
  isLong: boolean;
}) {
  // Default-collapsed on mobile when long. Desktop always shows the full
  // content because the multi-column layout means even very long blurbs
  // don't push the page miles down.
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="relative md:hidden">
        {/* Mobile container with fade + collapse */}
        <div
          className={`text-buzz-text text-sm leading-relaxed overflow-hidden transition-[max-height] duration-300 ${
            isLong && !expanded ? "max-h-[280px]" : "max-h-[20000px]"
          }`}
        >
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={markdownComponents}>
            {markdown}
          </ReactMarkdown>
        </div>
        {/* Fade overlay only when collapsed — fades to black so it matches
            bg-buzz-bg without relying on a CSS variable that may not exist. */}
        {isLong && !expanded && (
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-24 pointer-events-none"
            style={{
              background:
                "linear-gradient(180deg, rgba(10,10,11,0) 0%, rgba(10,10,11,0.85) 60%, rgba(10,10,11,1) 100%)",
            }}
          />
        )}
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-4 w-full rounded-xl border-2 border-buzz-accent bg-buzz-accent/10 px-4 py-3 text-buzz-accent font-bold uppercase tracking-wider text-sm hover:bg-buzz-accent hover:text-black transition flex items-center justify-center gap-2"
          >
            <span>{expanded ? "Show less" : "Read more"}</span>
            <span aria-hidden className="text-base">{expanded ? "▴" : "▾"}</span>
          </button>
        )}
      </div>

      {/* Desktop: two-column layout, no collapse needed.
          columns-2 with column-gap is a CSS multi-column container —
          paragraphs / headings / lists flow naturally between the two
          columns based on height. The `break-inside-avoid` classes on
          each element keep them intact rather than splitting across
          column boundaries. */}
      <div className="hidden md:block columns-2 gap-10 text-buzz-text text-base leading-relaxed [column-rule:1px_solid_rgba(255,255,255,0.06)]">
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={markdownComponents}>
          {markdown}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function Stat({ value, label, accent }: { value: string | number; label: string; accent: string }) {
  return (
    <div
      className="px-4 py-2 rounded-lg border bg-buzz-card/50 backdrop-blur"
      style={{ borderColor: `${accent}55` }}
    >
      <div className="text-2xl font-bold leading-tight" style={{ color: accent }}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-buzz-mute">{label}</div>
    </div>
  );
}

function TabButton({ active, onClick, accent, children }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-4 py-3 text-sm font-medium border-b-2 transition shrink-0"
      style={{
        color: active ? "var(--buzz-text)" : "var(--buzz-mute)",
        borderColor: active ? accent : "transparent",
        fontWeight: active ? 700 : 500,
      }}
    >
      {children}
    </button>
  );
}

function DayPill({ active, onClick, accent, children }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 rounded-full text-xs font-medium border transition"
      style={{
        background: active ? accent : "transparent",
        borderColor: active ? accent : "var(--buzz-border)",
        color: active ? "white" : "var(--buzz-mute)",
      }}
    >
      {children}
    </button>
  );
}

// Inline list/grid toggle next to the day pills. Smaller affordance
// than the day pills because picking a view is a once-per-visit
// preference (vs filtering by day, which the user does mid-browse).
function ViewToggleButton({ active, onClick, accent, children }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1 rounded-md text-xs font-medium transition"
      style={{
        background: active ? accent : "transparent",
        color: active ? "white" : "var(--buzz-mute)",
      }}
    >
      {children}
    </button>
  );
}

// Quick count of distinct venues in a filtered events list. Used to
// decide whether to even show the List/Grid toggle — a single-venue
// festival has no grid to draw.
function distinctEventVenueCount(events: EventLite[]): number {
  const ids = new Set<string>();
  for (const e of events) ids.add(e.venue_id);
  return ids.size;
}

// Timeline-grid Schedule view. The classic festival-programme look:
// venues as columns across the top, time running down the side, acts
// as blocks positioned by start time and sized by duration. Lets a
// punter see at a glance "who's on at 9pm and where".
//
// Layout strategy:
//   • Desktop (sm+): a real grid. Horizontal scroll when many venues.
//     Each venue is a fixed-width column; events absolutely positioned
//     within the column at top = (start - earliest)*pxPerMin, height =
//     duration*pxPerMin. Hour gridlines drawn behind for orientation.
//   • Mobile: the grid is unreadable on narrow viewports. Falls back
//     to per-venue vertical stacks (each venue's set list in order),
//     which is closer to how mobile users actually browse.
//
// One-day-at-a-time. When dayFilter === "all" but the events span
// multiple days, we show a small section per day.
const GRID_PX_PER_MIN = 1.4; // 60min = 84px tall (~ 2 lines of text)
const GRID_VENUE_COL_WIDTH = 200; // px per venue column on desktop
const GRID_HEADER_HEIGHT = 36; // sticky venue-name row
const GRID_TIME_COL_WIDTH = 56; // sticky time labels on the left

function ScheduleGrid({
  events,
  venues,
  accent,
}: {
  events: EventLite[];
  venues: Venue[];
  accent: string;
}) {
  // Group events by London-local calendar day so a 2-day festival
  // renders as two grids stacked.
  const byDay = useMemo(() => {
    const m = new Map<string, EventLite[]>();
    for (const e of events) {
      const day = new Date(e.start_time).toLocaleDateString("en-CA", {
        timeZone: "Europe/London",
      });
      const arr = m.get(day) ?? [];
      arr.push(e);
      m.set(day, arr);
    }
    return m;
  }, [events]);

  const days = Array.from(byDay.keys()).sort();

  if (events.length === 0) {
    return (
      <div className="card p-10 text-center">
        <div className="text-4xl mb-3">🎵</div>
        <p className="text-buzz-mute text-sm">No events scheduled for this day yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {days.map((day) => (
        <ScheduleGridDay
          key={day}
          day={day}
          events={byDay.get(day)!}
          venues={venues}
          accent={accent}
          showDayHeader={days.length > 1}
        />
      ))}
    </div>
  );
}

function ScheduleGridDay({
  day,
  events,
  venues,
  accent,
  showDayHeader,
}: {
  day: string;
  events: EventLite[];
  venues: Venue[];
  accent: string;
  showDayHeader: boolean;
}) {
  // 1. Compute per-venue groups (drives the column set).
  // 2. Compute time bounds — round earliest down to the hour, latest
  //    up to the hour, so the gridlines land cleanly.
  const venuesById = useMemo(() => {
    const m = new Map<string, Venue>();
    for (const v of venues) m.set(v.id, v);
    return m;
  }, [venues]);

  const byVenue = useMemo(() => {
    const m = new Map<string, EventLite[]>();
    for (const e of events) {
      const arr = m.get(e.venue_id) ?? [];
      arr.push(e);
      m.set(e.venue_id, arr);
    }
    // Sort each venue's events chronologically — needed for both
    // grid placement (overlap detection) and the mobile per-venue list.
    for (const arr of m.values()) {
      arr.sort((a, b) => a.start_time.localeCompare(b.start_time));
    }
    return m;
  }, [events]);

  // Ordered list of venues that actually have events this day. Preserve
  // the festival's venue order (matches the Venues tab); fall back to
  // alphabetical for venues not in the venues prop (e.g. brand-new
  // venues the cache hasn't refetched yet).
  const venueIds = useMemo(() => {
    const present = Array.from(byVenue.keys());
    const order = new Map<string, number>();
    venues.forEach((v, i) => order.set(v.id, i));
    present.sort((a, b) => {
      const ao = order.get(a) ?? 999;
      const bo = order.get(b) ?? 999;
      if (ao !== bo) return ao - bo;
      const an = venuesById.get(a)?.name ?? a;
      const bn = venuesById.get(b)?.name ?? b;
      return an.localeCompare(bn);
    });
    return present;
  }, [byVenue, venues, venuesById]);

  // Time window: floor earliest start to the hour, ceil latest end to
  // the hour. Use effective end (start + 60min fallback) when end is null.
  const { earliestMin, latestMin } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const e of events) {
      const s = londonMinutesIntoDay(e.start_time, day);
      const end = e.end_time
        ? londonMinutesIntoDay(e.end_time, day)
        : s + 60;
      if (s < lo) lo = s;
      if (end > hi) hi = end;
    }
    if (lo === Infinity) { lo = 18 * 60; hi = 23 * 60; }
    return {
      earliestMin: Math.floor(lo / 60) * 60,
      latestMin: Math.ceil(hi / 60) * 60,
    };
  }, [events, day]);

  const totalMin = Math.max(60, latestMin - earliestMin);
  const totalPx = totalMin * GRID_PX_PER_MIN;
  const hourLines: number[] = [];
  for (let m = 0; m <= totalMin; m += 60) hourLines.push(m);

  return (
    <section>
      {showDayHeader && (
        <h3
          className="font-display text-2xl uppercase mb-4"
          style={{ color: accent }}
        >
          {formatDayLong(day)}
        </h3>
      )}

      {/* MOBILE: per-venue vertical stack. Grid is unreadable below
          ~640px so we don't even attempt it. */}
      <div className="sm:hidden flex flex-col gap-6">
        {venueIds.map((vid) => {
          const venue = venuesById.get(vid);
          const vEvents = byVenue.get(vid)!;
          return (
            <div key={vid} className="card p-4">
              <h4 className="font-medium mb-3" style={{ color: accent }}>
                {venue?.name ?? "Unknown venue"}
                {venue?.city && (
                  <span className="text-buzz-mute text-xs font-normal ml-2">
                    {venue.city.name}
                  </span>
                )}
              </h4>
              <ul className="flex flex-col gap-2">
                {vEvents.map((e) => (
                  <li key={e.id} className="flex gap-3 items-baseline">
                    <span className="text-xs font-bold uppercase tracking-wider min-w-[68px]" style={{ color: accent }}>
                      {formatEventTime(e.start_time, e.end_time ?? undefined).split("·").pop()?.trim()}
                    </span>
                    <Link
                      href={`/${e.venue?.city?.slug ?? "dundee"}/events/${e.id}`}
                      className="flex-1 min-w-0 text-sm hover:text-buzz-accent transition truncate"
                    >
                      {e.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* DESKTOP: the actual grid. Horizontal scroll when many venues. */}
      <div className="hidden sm:block overflow-x-auto -mx-4 sm:mx-0">
        <div
          className="relative inline-block px-4 sm:px-0"
          style={{
            minWidth: GRID_TIME_COL_WIDTH + venueIds.length * GRID_VENUE_COL_WIDTH,
          }}
        >
          {/* Sticky venue header row */}
          <div
            className="flex sticky top-0 z-10 bg-buzz-bg/95 backdrop-blur"
            style={{ height: GRID_HEADER_HEIGHT }}
          >
            <div style={{ width: GRID_TIME_COL_WIDTH }} />
            {venueIds.map((vid) => {
              const venue = venuesById.get(vid);
              return (
                <div
                  key={vid}
                  className="flex items-center px-2 border-l border-buzz-border/40 text-xs font-medium truncate"
                  style={{ width: GRID_VENUE_COL_WIDTH }}
                  title={venue?.name}
                >
                  {venue?.name ?? "Venue"}
                </div>
              );
            })}
          </div>

          {/* Body: hour gridlines + per-venue absolute-positioned blocks */}
          <div
            className="relative"
            style={{ height: totalPx }}
          >
            {/* Hour gridlines + time labels (left column) */}
            {hourLines.map((m) => {
              const isLast = m === totalMin;
              const hour = (earliestMin + m) / 60;
              const hourLabel = formatHour24To12(hour);
              return (
                <div
                  key={m}
                  className="absolute left-0 right-0 flex"
                  style={{ top: m * GRID_PX_PER_MIN }}
                >
                  <div
                    className="text-[10px] text-buzz-mute font-mono pr-2 text-right -translate-y-1/2"
                    style={{ width: GRID_TIME_COL_WIDTH }}
                  >
                    {!isLast && hourLabel}
                  </div>
                  <div
                    className="flex-1 border-t"
                    style={{ borderColor: "var(--buzz-border)" }}
                  />
                </div>
              );
            })}

            {/* Event blocks per venue column */}
            <div
              className="absolute top-0 right-0 bottom-0 flex"
              style={{ left: GRID_TIME_COL_WIDTH }}
            >
              {venueIds.map((vid) => {
                const vEvents = byVenue.get(vid)!;
                return (
                  <div
                    key={vid}
                    className="relative border-l border-buzz-border/40"
                    style={{ width: GRID_VENUE_COL_WIDTH }}
                  >
                    {vEvents.map((e) => {
                      const startMin = londonMinutesIntoDay(e.start_time, day) - earliestMin;
                      const endMin = e.end_time
                        ? londonMinutesIntoDay(e.end_time, day) - earliestMin
                        : startMin + 60;
                      const heightPx = Math.max(28, (endMin - startMin) * GRID_PX_PER_MIN - 2);
                      return (
                        <Link
                          key={e.id}
                          href={`/${e.venue?.city?.slug ?? "dundee"}/events/${e.id}`}
                          className="absolute left-1 right-1 rounded-md p-1.5 overflow-hidden hover:opacity-90 transition group"
                          style={{
                            top: startMin * GRID_PX_PER_MIN,
                            height: heightPx,
                            background: `${accent}25`,
                            borderLeft: `3px solid ${accent}`,
                          }}
                          title={`${e.title} · ${formatEventTime(e.start_time, e.end_time ?? undefined)}`}
                        >
                          <div className="text-[11px] font-medium leading-tight truncate text-buzz-text group-hover:underline">
                            {e.title}
                          </div>
                          <div className="text-[10px] text-buzz-mute mt-0.5 font-mono">
                            {formatHHMM(e.start_time)}
                            {e.end_time && `–${formatHHMM(e.end_time)}`}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// Minutes-since-start-of-day for the given event's start_time,
// interpreted in Europe/London. We anchor to `day` so an event whose
// start straddles midnight (rare but possible for after-midnight
// last sets) still reports a sensible minute offset relative to the
// day it's listed under.
function londonMinutesIntoDay(iso: string, day: string): number {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(get("minute"), 10);
  let mins = hour * 60 + minute;
  // If the event's calendar day is after the section's `day`, add 24h
  // so a 01:00 set listed under the previous day's grid renders below
  // the rest, not at the top.
  if (ymd > day) mins += 24 * 60;
  return mins;
}

function formatHour24To12(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  if (h < 12) return `${h}am`;
  return `${h - 12}pm`;
}

function formatHHMM(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(iso)).toLowerCase().replace(/\s/g, "").replace(":00", "");
}

function VenueGrid({ venues, accent }: { venues: Venue[]; accent: string }) {
  if (venues.length === 0) {
    return <div className="card p-10 text-center text-buzz-mute">No venues confirmed yet — check back soon.</div>;
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {venues.map((v) => (
        <Link
          key={v.id}
          href={`/${v.city?.slug ?? "dundee"}/venues/${v.slug}`}
          className="card p-3 flex flex-col gap-2 hover:border-buzz-accent transition"
          style={{ borderColor: "transparent" }}
        >
          <div className="aspect-square rounded-md bg-buzz-surface border border-buzz-border overflow-hidden">
            <CardArt
              imageUrl={v.cover_photo_url || v.logo_url}
              fit="contain"
              fallbackName={v.name}
              fallbackKind="venue"
            />
          </div>
          <div>
            <div className="font-medium text-sm leading-tight truncate">{v.name}</div>
            <div className="text-[11px] text-buzz-mute mt-0.5">
              {v.city?.name ?? "Dundee"} · <span style={{ color: accent }} className="font-bold">{v.eventCount} act{v.eventCount === 1 ? "" : "s"}</span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function ArtistsGrid({
  events,
  lineup,
  festivalDateRange,
  accent,
  contactEmail,
  pickedArtistIds,
  signedIn,
  onTogglePick,
}: {
  events: EventLite[];
  // Typed-in lineup (sql/056) — admin adds acts directly with time + stage.
  // Independent from `events`/`event_artists`; rendered as a chronologically
  // grouped section above the alphabetical artist grid below.
  lineup: LineupRow[];
  festivalDateRange: { start: string; end: string };
  accent: string;
  contactEmail: string | null;
  pickedArtistIds: Set<string>;
  signedIn: boolean;
  onTogglePick: (artistId: string, on: boolean) => void;
}) {
  // Flatten + dedupe by artist id, keep first occurrence's event for context.
  // Artists that ALSO appear in the typed-in lineup get filtered out of the
  // event-derived grid below so they're not shown twice.
  const lineupArtistIds = new Set(lineup.map((r) => r.artist.id));
  const seen = new Map<string, { artist: EventArtist; firstEvent: EventLite }>();
  for (const e of events) {
    for (const a of e.artists ?? []) {
      if (lineupArtistIds.has(a.id)) continue;
      if (!seen.has(a.id)) seen.set(a.id, { artist: a, firstEvent: e });
    }
  }
  const list = Array.from(seen.values()).sort((a, b) =>
    a.artist.name.localeCompare(b.artist.name),
  );

  const showLineupSection = lineup.length > 0;
  const showEventArtists = list.length > 0;

  if (!showLineupSection && !showEventArtists) {
    return (
      <div className="card p-10 text-center">
        <div className="text-5xl mb-3">🎤</div>
        <div className="font-display text-3xl uppercase mb-2" style={{ color: accent }}>Lineup TBA</div>
        <p className="text-buzz-mute max-w-md mx-auto mb-1">
          Artists are still being announced — check back soon. Each one will link straight to their page on The Buzz Guide.
        </p>
        {contactEmail && (
          <p className="text-buzz-mute text-sm max-w-md mx-auto">
            Want to play? <a href={`mailto:${contactEmail}`} className="text-buzz-accent hover:underline">{contactEmail}</a>
          </p>
        )}
      </div>
    );
  }

  // Group the typed-in lineup by calendar day (UK local) so multi-day
  // festivals get day-by-day timetables. TBA (no time) goes last.
  const byDay = new Map<string, LineupRow[]>();
  const TBA_KEY = "__tba__";
  for (const r of lineup) {
    const key = r.performance_time
      ? new Date(r.performance_time).toLocaleDateString("en-CA", { timeZone: "Europe/London" })
      : TBA_KEY;
    const arr = byDay.get(key) ?? [];
    arr.push(r);
    byDay.set(key, arr);
  }
  const dayKeys = Array.from(byDay.keys()).sort((a, b) => {
    if (a === TBA_KEY) return 1;
    if (b === TBA_KEY) return -1;
    return a.localeCompare(b);
  });
  const isMultiDay = festivalDateRange.start !== festivalDateRange.end;
  return (
    <div className="flex flex-col gap-8">
      {/* Typed-in lineup — chronological, grouped by day on multi-day fests */}
      {showLineupSection && (
        <div>
          <h3 className="eyebrow mb-3" style={{ color: accent }}>Lineup</h3>
          <div className="flex flex-col gap-6">
            {dayKeys.map((dayKey) => {
              const dayRows = byDay.get(dayKey) ?? [];
              return (
                <div key={dayKey}>
                  {(isMultiDay || dayKey === TBA_KEY) && (
                    <div className="font-display text-xl uppercase mb-2 text-buzz-text">
                      {dayKey === TBA_KEY ? "Time TBA" : formatLineupDay(dayKey)}
                    </div>
                  )}
                  <ul className="card divide-y divide-buzz-border/60">
                    {dayRows.map((r) => {
                      const picked = pickedArtistIds.has(r.artist.id);
                      return (
                        <li key={r.id} className="relative">
                          <Link
                            href={`/artists/${r.artist.slug}`}
                            className="flex items-center gap-3 p-3 hover:bg-buzz-card/40 transition"
                          >
                            <div className="w-14 h-14 shrink-0 rounded-md bg-buzz-surface border border-buzz-border overflow-hidden">
                              <CardArt
                                imageUrl={r.artist.image_url}
                                fit="cover"
                                fallbackName={r.artist.name}
                                fallbackKind="artist"
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">{r.artist.name}</div>
                              <div className="text-xs text-buzz-mute mt-0.5 truncate">
                                {r.performance_time ? formatLineupSlotTime(r.performance_time) : "Time TBA"}
                                {r.stage && <> · <span>{r.stage}</span></>}
                              </div>
                            </div>
                          </Link>
                          <div className="absolute top-3 right-3 z-10">
                            <HeartOnCard
                              artistId={r.artist.id}
                              initialPicked={picked}
                              signedIn={signedIn}
                              onChange={onTogglePick}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* "Also playing" — event-derived artists that weren't typed into
          the lineup. Hidden when the typed lineup covers everyone. */}
      {showEventArtists && (
        <div>
          {showLineupSection && (
            <h3 className="eyebrow mb-3" style={{ color: accent }}>Also playing</h3>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {list.map(({ artist, firstEvent }) => {
        const picked = pickedArtistIds.has(artist.id);
        return (
          <div key={artist.id} className="relative">
            <Link
              href={`/artists/${artist.slug}`}
              className="card p-3 flex flex-col gap-2 hover:border-buzz-accent transition"
              style={{ borderColor: picked ? "rgba(244,63,94,0.5)" : "transparent" }}
            >
              <div className="aspect-square rounded-md bg-buzz-surface border border-buzz-border overflow-hidden">
                <CardArt
                  imageUrl={artist.image_url}
                  fit="cover"
                  fallbackName={artist.name}
                  fallbackKind="artist"
                />
              </div>
              <div>
                <div className="font-medium text-sm leading-tight truncate">{artist.name}</div>
                <div className="text-[11px] text-buzz-mute mt-0.5 truncate">
                  {firstEvent.venue?.name ?? "—"}
                </div>
              </div>
            </Link>
            {/* Heart sits ABOVE the link so its click doesn't navigate. The
                FavouriteButton itself handles sign-in redirect for anon users. */}
            <div className="absolute top-2 right-2 z-10">
              <HeartOnCard
                artistId={artist.id}
                initialPicked={picked}
                signedIn={signedIn}
                onChange={onTogglePick}
              />
            </div>
          </div>
        );
      })}
          </div>
        </div>
      )}
    </div>
  );
}

// Day label for the lineup section ("Saturday 30th May").
// Same shape as formatDayLong but accepts a YYYY-MM-DD key.
function formatLineupDay(dayKey: string): string {
  const d = new Date(dayKey + "T12:00:00");
  if (Number.isNaN(d.getTime())) return dayKey;
  const day = d.getDate();
  const suffix = day % 100 >= 11 && day % 100 <= 13
    ? "th"
    : ["th", "st", "nd", "rd"][day % 10] ?? "th";
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).replace(String(day), `${day}${suffix}`);
}

// "19:00 · Saturday" → just "19:00" since we already group by day above
// it on multi-day festivals. Single-day festivals don't show the day
// header, so it doesn't matter either way.
function formatLineupSlotTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

function ScheduleList({
  events,
  lineup,
  festivalDateRange,
  accent,
  contactEmail,
}: {
  events: EventLite[];
  // Typed-in lineup (sql/056). Used as a fallback when no timed events
  // have been published yet — some festivals announce the lineup +
  // stages well before set times, and we'd rather show artist + stage
  // than the "Coming soon" empty state.
  lineup: LineupRow[];
  festivalDateRange: { start: string; end: string };
  accent: string;
  contactEmail: string | null;
}) {
  // No timed events but lineup is set → render the lineup instead of
  // an empty state. Groups by day; acts without a time fall into a
  // "Time TBA" bucket at the end.
  if (events.length === 0 && lineup.length > 0) {
    return (
      <LineupScheduleFallback
        lineup={lineup}
        festivalDateRange={festivalDateRange}
        accent={accent}
      />
    );
  }

  if (events.length === 0) {
    return (
      <div className="card p-10 text-center">
        <div className="text-5xl mb-3">🎤</div>
        <div className="font-display text-3xl uppercase mb-2" style={{ color: accent }}>Coming soon</div>
        <p className="text-buzz-mute max-w-md mx-auto mb-1">
          Lineup is still being booked — check back soon for the full schedule.
        </p>
        {contactEmail && (
          <p className="text-buzz-mute text-sm max-w-md mx-auto">
            Want to play? <a href={`mailto:${contactEmail}`} className="text-buzz-accent hover:underline">{contactEmail}</a>
          </p>
        )}
      </div>
    );
  }
  // Group by day
  const byDay = new Map<string, EventLite[]>();
  for (const e of events) {
    const day = e.start_time.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(e);
    byDay.set(day, list);
  }
  return (
    <div className="flex flex-col gap-6">
      {Array.from(byDay.entries()).map(([day, list]) => (
        <section key={day}>
          <h2 className="font-display text-2xl uppercase mb-3" style={{ color: accent }}>
            {formatDayLong(day)}
          </h2>
          <ul className="card divide-y divide-buzz-border/60">
            {list.map((e) => (
              <li key={e.id} className="p-4 flex items-center gap-4">
                {e.image_url && (
                  <Link
                    href={`/${e.venue?.city?.slug ?? "dundee"}/events/${e.id}`}
                    className="shrink-0"
                  >
                    <div
                      className="w-14 h-14 rounded bg-buzz-surface border border-buzz-border"
                      style={{ backgroundImage: `url(${e.image_url})`, backgroundSize: "cover", backgroundPosition: "center" }}
                    />
                  </Link>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold uppercase tracking-wider" style={{ color: accent }}>
                    {formatEventTime(e.start_time)}
                  </div>
                  <Link
                    href={`/${e.venue?.city?.slug ?? "dundee"}/events/${e.id}`}
                    className="font-display text-lg uppercase truncate hover:text-buzz-accent transition block"
                  >
                    {e.title}
                  </Link>
                  <div className="text-xs text-buzz-mute truncate flex items-center gap-1 flex-wrap">
                    {e.venue && (
                      <Link
                        href={`/${e.venue.city?.slug ?? "dundee"}/venues/${e.venue.slug}`}
                        className="hover:text-buzz-accent transition"
                      >
                        {e.venue.name}
                      </Link>
                    )}
                    {e.cover_charge && <span>· {e.cover_charge}</span>}
                  </div>
                  {e.artists && e.artists.length > 0 && (
                    <div className="text-xs mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                      {e.artists.map((a) => (
                        <Link
                          key={a.id}
                          href={`/artists/${a.slug}`}
                          className="text-buzz-mute hover:text-buzz-accent transition"
                        >
                          {a.name}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// Fallback Schedule view shown when a festival has typed-in lineup acts
// but no timed events yet. Mirrors the day-grouped layout of the main
// schedule, but the time column shows "Time TBA" + stage when set times
// haven't been published. Lets organisers announce who's playing where
// without committing to a full timetable.
function LineupScheduleFallback({
  lineup,
  festivalDateRange,
  accent,
}: {
  lineup: LineupRow[];
  festivalDateRange: { start: string; end: string };
  accent: string;
}) {
  const byDay = new Map<string, LineupRow[]>();
  const TBA_KEY = "__tba__";
  for (const r of lineup) {
    const key = r.performance_time
      ? new Date(r.performance_time).toLocaleDateString("en-CA", { timeZone: "Europe/London" })
      : TBA_KEY;
    const arr = byDay.get(key) ?? [];
    arr.push(r);
    byDay.set(key, arr);
  }
  const dayKeys = Array.from(byDay.keys()).sort((a, b) => {
    if (a === TBA_KEY) return 1;
    if (b === TBA_KEY) return -1;
    return a.localeCompare(b);
  });
  const isMultiDay = festivalDateRange.start !== festivalDateRange.end;
  // Hide the day heading entirely on single-day festivals where every
  // act is TBA — a single "Time TBA" heading reads better than nothing
  // but a single "Saturday" heading above a TBA list is misleading.
  const onlyTbaOnSingleDay =
    !isMultiDay && dayKeys.length === 1 && dayKeys[0] === TBA_KEY;
  return (
    <div className="flex flex-col gap-6">
      {dayKeys.map((dayKey) => {
        const dayRows = byDay.get(dayKey) ?? [];
        const heading =
          dayKey === TBA_KEY
            ? "Time TBA"
            : isMultiDay
            ? formatDayLong(dayKey)
            : "Lineup";
        return (
          <section key={dayKey}>
            {!onlyTbaOnSingleDay && (
              <h2 className="font-display text-2xl uppercase mb-3" style={{ color: accent }}>
                {heading}
              </h2>
            )}
            <ul className="card divide-y divide-buzz-border/60">
              {dayRows.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/artists/${r.artist.slug}`}
                    className="flex items-center gap-3 p-3 hover:bg-buzz-card/40 transition"
                  >
                    <div className="w-14 h-14 shrink-0 rounded-md bg-buzz-surface border border-buzz-border overflow-hidden">
                      <CardArt
                        imageUrl={r.artist.image_url}
                        fit="cover"
                        fallbackName={r.artist.name}
                        fallbackKind="artist"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{r.artist.name}</div>
                      <div className="text-xs text-buzz-mute mt-0.5 truncate">
                        {r.performance_time ? formatLineupSlotTime(r.performance_time) : "Time TBA"}
                        {r.stage && <> · <span>{r.stage}</span></>}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function GetInvolvedCard({ accent, contactEmail }: { accent: string; contactEmail: string }) {
  return (
    <div
      className="card p-5 mb-8 flex flex-col sm:flex-row items-start sm:items-center gap-4 border"
      style={{ borderColor: `${accent}55`, background: `${accent}0c` }}
    >
      <div className="text-3xl">🎸</div>
      <div className="flex-1 min-w-0">
        <div className="font-display text-lg uppercase" style={{ color: accent }}>Want to be involved?</div>
        <p className="text-sm text-buzz-mute mt-1">
          Spaces are still available for artists, DJs, bands and venues. Get in touch and we'll add you to the lineup.
        </p>
      </div>
      <a
        href={`mailto:${contactEmail}`}
        className="shrink-0 px-4 py-2 rounded-lg font-bold text-sm uppercase tracking-wider transition text-black hover:opacity-90"
        style={{ background: accent }}
      >
        ✉️ Email us
      </a>
    </div>
  );
}

function FestivalMap({
  venues,
  highlightedVenueIds,
}: {
  venues: Venue[];
  highlightedVenueIds?: Set<string>;
}) {
  const mapped = venues
    .filter((v) => typeof v.latitude === "number" && typeof v.longitude === "number")
    .map((v) => ({
      id: v.id,
      name: v.name,
      slug: v.slug,
      address: null,
      postcode: null,
      latitude: v.latitude,
      longitude: v.longitude,
      upcoming_count: v.eventCount,
    }));
  if (mapped.length === 0) {
    return (
      <div className="card p-10 text-center text-buzz-mute">
        None of the festival venues have coordinates yet — admin needs to backfill geo data via <code>/api/admin/backfill-geo</code>.
      </div>
    );
  }

  // Picks summary above the live map — text-only for now since CityMap
  // doesn't expose per-marker styling. Lists the venues hosting at least
  // one of the fan's favourited acts so they spot "their" venues fast.
  const pickedVenues = highlightedVenueIds && highlightedVenueIds.size > 0
    ? venues.filter((v) => highlightedVenueIds.has(v.id))
    : [];

  return (
    <div className="flex flex-col gap-4">
      {pickedVenues.length > 0 && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/5 px-4 py-3 text-sm">
          <div className="text-rose-300 font-bold uppercase tracking-wider text-[11px] mb-2">
            ❤ Your picks are playing at
          </div>
          <div className="flex flex-wrap gap-2">
            {pickedVenues.map((v) => (
              <Link
                key={v.id}
                href={`/dundee/venues/${v.slug}`}
                className="px-2.5 py-1 rounded-full bg-rose-500/15 border border-rose-500/40 text-rose-200 hover:bg-rose-500/25 text-xs"
              >
                {v.name}
              </Link>
            ))}
          </div>
        </div>
      )}
      <CityMap citySlug="dundee" venues={mapped as any} />
    </div>
  );
}

// ---------- helpers ----------

// Card image with onError + onLoad-size fallback to the colored monogram.
// We use <img> rather than CSS background-image because:
//   1. CSS can't detect 404s — rotted Facebook signed URLs render as silent
//      black squares with bg-image; <img onError> fires reliably.
//   2. FB also sometimes returns 200 OK with a 1×1 transparent pixel for
//      expired/restricted photos. The load "succeeds" so onError never fires,
//      but the image is functionally blank. onLoad with a naturalWidth check
//      catches that case.
function CardArt({
  imageUrl,
  fit,
  fallbackName,
  fallbackKind,
}: {
  imageUrl: string | null | undefined;
  fit: "cover" | "contain";
  fallbackName: string;
  fallbackKind: "venue" | "artist";
}) {
  const [broken, setBroken] = useState(false);
  const showFallback = !imageUrl || broken;
  if (showFallback) return <Monogram name={fallbackName} kind={fallbackKind} />;
  const objectFit: CSSProperties["objectFit"] = fit;
  return (
    <img
      src={imageUrl as string}
      alt=""
      onError={() => setBroken(true)}
      onLoad={(e) => {
        const el = e.currentTarget;
        // Anything under 16px square is almost certainly a tracking pixel or
        // FB's "image gone" placeholder. Real venue photos are >=100px.
        if (el.naturalWidth < 16 || el.naturalHeight < 16) {
          setBroken(true);
        }
      }}
      loading="lazy"
      className="w-full h-full"
      style={{ objectFit, objectPosition: "center" }}
    />
  );
}

// Colored-initials fallback for cards with no image. Deterministic hue per
// name so the venues/artists grid gets visual variety even when most rows
// have no photo. Inspired by Apple Music's "no artwork" placeholder.
function Monogram({ name, kind }: { name: string; kind: "venue" | "artist" }) {
  // Stable hue 0-359 from the name — same name always gets the same colour.
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  // Two-letter initials. Skip "The" so "The Funky Wee Teapot" → FW not TF.
  const words = name
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w && !/^(the|a|an|&)$/i.test(w));
  const initials = (words[0]?.[0] ?? name[0] ?? "?") + (words[1]?.[0] ?? "");
  const display = initials.toUpperCase().slice(0, 2);
  return (
    <div
      className="w-full h-full grid place-items-center relative overflow-hidden"
      style={{
        background: `linear-gradient(135deg, hsl(${hue}, 55%, 24%) 0%, hsl(${(hue + 35) % 360}, 60%, 14%) 100%)`,
      }}
      aria-hidden
    >
      <span
        className="font-display select-none"
        style={{
          color: `hsl(${hue}, 70%, 78%)`,
          fontSize: "clamp(28px, 5vw, 48px)",
          fontWeight: 900,
          letterSpacing: "-0.04em",
          textShadow: "0 2px 12px rgba(0,0,0,0.35)",
        }}
      >
        {display}
      </span>
      <span
        className="absolute bottom-1.5 right-2 text-[10px] opacity-50"
        style={{ color: `hsl(${hue}, 60%, 85%)` }}
      >
        {kind === "venue" ? "🐝" : "🎤"}
      </span>
    </div>
  );
}

function shade(hex: string, percent: number): string {
  // Simple darken/lighten — keeps the festival hero readable on light theme colours
  let c = hex.replace("#", "");
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  const num = parseInt(c, 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + Math.round(2.55 * percent)));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + Math.round(2.55 * percent)));
  const b = Math.max(0, Math.min(255, (num & 0xff) + Math.round(2.55 * percent)));
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

// formatFestivalDateRange / formatDayShort / formatDayLong now live
// in @/lib/utils so every festival surface formats dates the same
// way (with ordinal suffixes: 30 → 30th, 1 → 1st, etc.). The
// previous local copies didn't include ordinals.
