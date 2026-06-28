"use client";

import Link from "next/link";
import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  adminCancelEventPromo,
  adminCancelVenueSpotlight,
  adminGrantEventPromo,
  adminGrantVenueSpotlight,
  type EventPromoKind,
} from "./actions";

const EVENT_PROMOS: {
  kind: EventPromoKind;
  emoji: string;
  label: string;
  col:
    | "featured_until"
    | "highlighted_until"
    | "genre_takeover_until"
    | "weekend_boost_until";
}[] = [
  { kind: "featured", emoji: "📌", label: "Pin to top", col: "featured_until" },
  { kind: "highlighted", emoji: "⭐", label: "Highlight", col: "highlighted_until" },
  { kind: "genre_takeover", emoji: "🎚️", label: "Genre takeover", col: "genre_takeover_until" },
  { kind: "weekend_boost", emoji: "🔥", label: "Weekend boost", col: "weekend_boost_until" },
];

function daysLeft(iso: string | null) {
  if (!iso) return 0;
  const ms = new Date(iso).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / (24 * 60 * 60 * 1000)) : 0;
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "in the future";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const d = Math.round(hrs / 24);
  return `${d}d ago`;
}

function formatDateShort(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function PromotionsOverviewClient({
  spotlightVenues,
  promotedEvents,
  allVenues,
  recentlyExpiredSpotlightVenues,
  recentlyExpiredPromoEvents,
}: {
  spotlightVenues: any[];
  promotedEvents: any[];
  allVenues: any[];
  recentlyExpiredSpotlightVenues: any[];
  recentlyExpiredPromoEvents: any[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const filteredVenues = useMemo(
    () =>
      allVenues.filter((v) =>
        v.name.toLowerCase().includes(filter.trim().toLowerCase()),
      ),
    [allVenues, filter],
  );

  function cancelSpotlight(venueId: string) {
    setError(null);
    start(async () => {
      const r = await adminCancelVenueSpotlight(venueId);
      if (r?.error) setError(r.error);
      else router.refresh();
    });
  }
  function cancelEvent(eventId: string, kind: EventPromoKind) {
    setError(null);
    start(async () => {
      const r = await adminCancelEventPromo(eventId, kind);
      if (r?.error) setError(r.error);
      else router.refresh();
    });
  }
  function regrantSpotlight(venueId: string) {
    setError(null);
    start(async () => {
      const r = await adminGrantVenueSpotlight(venueId, 7);
      if (r?.error) setError(r.error);
      else router.refresh();
    });
  }
  function regrantEvent(eventId: string, kind: EventPromoKind) {
    setError(null);
    start(async () => {
      const r = await adminGrantEventPromo(eventId, kind, 7);
      if (r?.error) setError(r.error);
      else router.refresh();
    });
  }

  // Build recently-expired rows (filtered server-side to last 7 days)
  type ExpiredRow = {
    id: string;
    label: string;
    emoji: string;
    venueId: string;
    venueName: string;
    eventId?: string;
    eventTitle?: string;
    kind?: EventPromoKind;
    expiredAt: string;
  };

  const expiredRows: ExpiredRow[] = [];
  for (const v of recentlyExpiredSpotlightVenues) {
    expiredRows.push({
      id: `v:${v.id}`,
      label: "Spotlight",
      emoji: "🔦",
      venueId: v.id,
      venueName: v.name,
      expiredAt: v.spotlight_until,
    });
  }
  const KIND_BY_COL: Record<string, EventPromoKind> = {
    featured_until: "featured",
    highlighted_until: "highlighted",
    genre_takeover_until: "genre_takeover",
    weekend_boost_until: "weekend_boost",
  };
  for (const e of recentlyExpiredPromoEvents) {
    for (const p of EVENT_PROMOS) {
      const at = e[p.col] as string | null;
      if (!at) continue;
      const ts = new Date(at).getTime();
      if (ts > Date.now()) continue; // still active, not expired
      expiredRows.push({
        id: `e:${e.id}:${p.col}`,
        label: p.label,
        emoji: p.emoji,
        venueId: e.venue?.id,
        venueName: e.venue?.name ?? "—",
        eventId: e.id,
        eventTitle: e.title,
        kind: KIND_BY_COL[p.col],
        expiredAt: at,
      });
    }
  }
  expiredRows.sort(
    (a, b) =>
      new Date(b.expiredAt).getTime() - new Date(a.expiredAt).getTime(),
  );

  // Flatten events × promo kinds into one row per active promotion
  const eventPromoRows = promotedEvents.flatMap((e) =>
    EVENT_PROMOS.map((p) => {
      const left = daysLeft(e[p.col]);
      return left > 0
        ? {
            id: `${e.id}:${p.kind}`,
            eventId: e.id,
            kind: p.kind,
            label: p.label,
            emoji: p.emoji,
            until: e[p.col],
            left,
            event: e,
          }
        : null;
    }).filter(Boolean) as Array<{
      id: string;
      eventId: string;
      kind: EventPromoKind;
      label: string;
      emoji: string;
      until: string;
      left: number;
      event: any;
    }>,
  );

  return (
    <div className="flex flex-col gap-8">
      {error && (
        <div className="card p-3 text-sm text-rose-400">{error}</div>
      )}

      {/* Spotlight venues */}
      <section>
        <h2 className="font-display text-2xl uppercase mb-3">
          🔦 Active venue spotlights{" "}
          <span className="text-buzz-mute text-sm font-normal">
            ({spotlightVenues.length})
          </span>
        </h2>
        {spotlightVenues.length === 0 ? (
          <div className="card p-6 text-buzz-mute">
            No venues currently spotlighted.
          </div>
        ) : (
          <ul className="card divide-y divide-buzz-border/60">
            {spotlightVenues.map((v) => {
              const left = daysLeft(v.spotlight_until);
              return (
                <li
                  key={v.id}
                  className="p-4 flex items-center gap-3 justify-between flex-wrap"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{v.name}</div>
                    <div className="text-xs text-buzz-mute">
                      {v.city?.name ?? "—"} · {left}d left
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Link
                      href={`/admin/venues/${v.id}/promote`}
                      className="btn-secondary"
                    >
                      Open
                    </Link>
                    <button
                      onClick={() => cancelSpotlight(v.id)}
                      disabled={pending}
                      className="btn-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Event promotions */}
      <section>
        <h2 className="font-display text-2xl uppercase mb-3">
          🎟️ Active event promotions{" "}
          <span className="text-buzz-mute text-sm font-normal">
            ({eventPromoRows.length})
          </span>
        </h2>
        {eventPromoRows.length === 0 ? (
          <div className="card p-6 text-buzz-mute">
            No event promotions are currently active.
          </div>
        ) : (
          <ul className="card divide-y divide-buzz-border/60">
            {eventPromoRows.map((r) => (
              <li
                key={r.id}
                className="p-4 flex items-center gap-3 justify-between flex-wrap"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    <span className="mr-1">{r.emoji}</span>
                    {r.label}{" "}
                    <span className="text-buzz-mute font-normal">·</span>{" "}
                    <span className="text-buzz-text/90">{r.event.title}</span>
                  </div>
                  <div className="text-xs text-buzz-mute">
                    {r.event.venue?.name ?? "—"} ·{" "}
                    {formatDateShort(r.event.start_time)} · {r.left}d left
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/admin/venues/${r.event.venue?.id}/promote`}
                    className="btn-secondary"
                  >
                    Open
                  </Link>
                  <button
                    onClick={() => cancelEvent(r.eventId, r.kind)}
                    disabled={pending}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recently expired (last 7 days) */}
      <section>
        <h2 className="font-display text-2xl uppercase mb-3">
          ⌛ Recently expired{" "}
          <span className="text-buzz-mute text-sm font-normal">
            (last 7 days · {expiredRows.length})
          </span>
        </h2>
        {expiredRows.length === 0 ? (
          <div className="card p-6 text-buzz-mute">
            Nothing has expired in the last 7 days.
          </div>
        ) : (
          <ul className="card divide-y divide-buzz-border/60">
            {expiredRows.map((r) => (
              <li
                key={r.id}
                className="p-4 flex items-center gap-3 justify-between flex-wrap"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    <span className="mr-1">{r.emoji}</span>
                    {r.label}
                    {r.eventTitle && (
                      <>
                        <span className="text-buzz-mute font-normal"> · </span>
                        <span className="text-buzz-text/90">
                          {r.eventTitle}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="text-xs text-buzz-mute">
                    {r.venueName} · expired {timeAgo(r.expiredAt)}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/admin/venues/${r.venueId}/promote`}
                    className="btn-secondary"
                  >
                    Open
                  </Link>
                  <button
                    onClick={() => {
                      if (r.eventId && r.kind) regrantEvent(r.eventId, r.kind);
                      else regrantSpotlight(r.venueId);
                    }}
                    disabled={pending}
                    className="btn-primary"
                    title="Re-grant this promotion for another 7 days"
                  >
                    Re-grant 7d
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Quick jump to any venue */}
      <section>
        <h2 className="font-display text-2xl uppercase mb-3">
          Grant a new promotion
        </h2>
        <p className="text-sm text-buzz-mute mb-3">
          Pick any approved venue to open its admin promote page.
        </p>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search venues…"
          className="w-full sm:w-80 mb-3 rounded-md bg-buzz-card border border-buzz-border px-3 py-2 text-sm"
        />
        <ul className="card divide-y divide-buzz-border/60 max-h-96 overflow-auto">
          {filteredVenues.map((v) => (
            <li
              key={v.id}
              className="p-3 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{v.name}</div>
                <div className="text-xs text-buzz-mute">
                  {v.city?.name ?? "—"}
                </div>
              </div>
              <Link
                href={`/admin/venues/${v.id}/promote`}
                className="btn-secondary"
              >
                Promote
              </Link>
            </li>
          ))}
          {filteredVenues.length === 0 && (
            <li className="p-4 text-sm text-buzz-mute">No venues match.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
