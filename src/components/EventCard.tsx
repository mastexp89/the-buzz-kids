import Link from "next/link";
import { formatEventTime, extractTownFromAddress, pickEventIcon } from "@/lib/utils";
import type { EventWithVenue } from "@/lib/types";
import { DistancePill } from "@/components/NearMeButton";
import EventThumb from "@/components/EventThumb";
import { AccessibilityBadges } from "@/components/AccessibilityBadges";
import { recurrenceLabel } from "@/lib/recurrence";

function isActive(iso: string | null | undefined) {
  return !!iso && new Date(iso).getTime() > Date.now();
}

// What the time/date badge says. For a multi-day run (end_date on a different
// day) we show the span instead of just the start — and "On now" when today
// falls inside it — so an ongoing exhibition doesn't read as a past one-day
// event sitting on its start date.
function dateBadgeLabel(event: EventWithVenue): string {
  // A weekly/daily series reads as its cadence ("Every Friday"), not the start
  // date — otherwise an ongoing club looks like a past one-off.
  const rec = recurrenceLabel((event as any).recurrence_pattern, event.start_time);
  if (rec) return rec;
  const start = new Date(event.start_time);
  const endStr = (event as any).end_date as string | null | undefined;
  if (endStr) {
    const end = new Date(`${endStr}T00:00:00`);
    if (!Number.isNaN(end.getTime()) && end.toDateString() !== start.toDateString()) {
      const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const startDay = new Date(start); startDay.setHours(0, 0, 0, 0);
      if (startDay <= today && end >= today) return `On now · until ${fmt(end)}`;
      return `${fmt(start)} → ${fmt(end)}`;
    }
  }
  return formatEventTime(event.start_time, event.end_time);
}

// "Ages 3–8" / "Ages 5+" / "Up to 4s" / null when unspecified.
function ageLabel(min: number | null | undefined, max: number | null | undefined): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return min === max ? `Age ${min}` : `Ages ${min}–${max}`;
  if (min != null) return `Ages ${min}+`;
  return `Up to ${max}s`;
}

export default function EventCard({ event, citySlug }: { event: EventWithVenue; citySlug: string }) {
  const highlighted = isActive(event.highlighted_until);
  const weekendBoost = isActive(event.weekend_boost_until);

  // Thumbnail: real event poster, otherwise an icon picked from genre
  // tags (with a title-based heuristic as a backup). Never assume "music"
  // for unknown categories — pickEventIcon falls through to 🎟️ instead.
  //
  // Important: compute the genre icon UNCONDITIONALLY, not just when
  // image_url is null. EventThumb falls back to this icon when the
  // image fails to load (broken FB URLs, etc.) — if we only computed
  // it for null URLs, the broken-URL fallback would render the wrong
  // emoji (was rendering "♪" for sports / karaoke / quiz nights).
  // Poster if the event has one; otherwise fall back to the attached place's
  // photo so events tied to a venue show something nicer than a bare icon.
  const v = event.venue as any | null;
  const venuePhoto = v
    ? v.cover_photo_url || v.image_url || (Array.isArray(v.gallery_image_urls) ? v.gallery_image_urls[0] : null) || v.logo_url || v.google_photo_url || null
    : null;
  const thumbPhoto = event.image_url ?? venuePhoto;
  const icon = pickEventIcon(event.title, (event.genres ?? []).map((g) => g.slug));

  return (
    <Link
      href={`/${citySlug}/events/${event.id}`}
      className={`card-hover group flex flex-col lift p-5 gap-3 h-full ${
        highlighted ? "border-buzz-accent shadow-[0_0_30px_rgba(253,185,19,0.25)]" : ""
      } ${event.cancelled ? "opacity-70" : ""}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center rounded-full bg-buzz-accent text-white text-[11px] font-bold uppercase tracking-wider px-2.5 py-1">
              {dateBadgeLabel(event)}
            </span>
            {weekendBoost && (
              <span className="inline-flex items-center rounded-full bg-rose-500 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5">
                🔥 Weekend pick
              </span>
            )}
            {event.cancelled && (
              <span className="inline-flex items-center rounded-full bg-rose-600/20 text-rose-400 border border-rose-600/40 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5">
                Cancelled
              </span>
            )}
          </div>

          <div>
            <h3 className="font-display text-xl sm:text-2xl uppercase leading-tight group-hover:text-buzz-accent transition">
              {event.title}
            </h3>
            <div className="text-sm text-buzz-mute mt-1 flex items-center gap-2 flex-wrap">
              <span>
                at <span className="text-buzz-text font-medium">{event.venue?.name ?? (event as any).location_name ?? (event as any).city?.name ?? "TBC"}</span>
                {(() => {
                  const town = event.venue
                    ? extractTownFromAddress((event.venue as any).address)
                    : (event as any).city?.name ?? null;
                  return town ? <span className="text-buzz-mute">, {town}</span> : null;
                })()}
              </span>
              {event.venue && (
                <DistancePill lat={(event.venue as any).latitude} lng={(event.venue as any).longitude} />
              )}
            </div>
          </div>
        </div>

        {/* Square thumbnail — real event poster if set, otherwise an icon
            picked from genre tags. Uses an <img> tag (not CSS background)
            so onError can flip to the icon fallback when the URL is
            rotted (typically expired Facebook signed URLs on old scraped
            events). */}
        <EventThumb imageUrl={thumbPhoto} icon={icon} />
      </div>

      {event.description && (
        <p className="text-sm text-buzz-mute line-clamp-2">{event.description}</p>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {(() => {
            const age = ageLabel((event as any).age_min, (event as any).age_max);
            return age ? (
              <span className="inline-flex items-center rounded-full bg-buzz-surface border border-buzz-border px-2.5 py-1 text-[11px] font-medium">
                {age}
              </span>
            ) : null;
          })()}
          {event.genres.slice(0, 3).map((g) => (
            <span key={g.id} className="chip text-[11px]">{g.name}</span>
          ))}
          {((event as any).is_free || event.cover_charge) && (
            <span className="ml-auto text-xs text-buzz-good font-semibold">
              {(event as any).is_free ? "Free" : event.cover_charge}
            </span>
          )}
        </div>
        {/* Accessibility / sensory icons — renders nothing when none set. */}
        <AccessibilityBadges items={(event as any).accessibility} size="sm" />
      </div>
    </Link>
  );
}
