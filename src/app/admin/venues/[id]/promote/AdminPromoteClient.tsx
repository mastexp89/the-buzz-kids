"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adminGrantEventPromo,
  adminCancelEventPromo,
  adminGrantVenueSpotlight,
  adminCancelVenueSpotlight,
  type EventPromoKind,
} from "@/app/admin/promotions/actions";

const COLUMN_BY_KIND: Record<
  EventPromoKind,
  | "featured_until"
  | "highlighted_until"
  | "genre_takeover_until"
  | "weekend_boost_until"
> = {
  featured: "featured_until",
  highlighted: "highlighted_until",
  genre_takeover: "genre_takeover_until",
  weekend_boost: "weekend_boost_until",
};

const PROMOS: {
  kind: EventPromoKind;
  emoji: string;
  label: string;
  desc: string;
}[] = [
  {
    kind: "featured",
    emoji: "📌",
    label: "Pin to top",
    desc: "Pin to the top of /dundee.",
  },
  {
    kind: "highlighted",
    emoji: "⭐",
    label: "Highlight",
    desc: "Yellow border + glow in listings.",
  },
  {
    kind: "genre_takeover",
    emoji: "🎚️",
    label: "Genre takeover",
    desc: "Top of the list when filtered by this gig's genres.",
  },
  {
    kind: "weekend_boost",
    emoji: "🔥",
    label: "Weekend boost",
    desc: "WEEKEND PICK badge on the gig.",
  },
];

function daysLeft(iso: string | null) {
  if (!iso) return 0;
  const ms = new Date(iso).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / (24 * 60 * 60 * 1000)) : 0;
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

export default function AdminPromoteClient({
  venue,
  events,
}: {
  venue: any;
  events: any[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(7);

  const safeDays = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 7;

  function grantSpotlight() {
    setError(null);
    start(async () => {
      const r = await adminGrantVenueSpotlight(venue.id, safeDays);
      if (r?.error) setError(r.error);
      else router.refresh();
    });
  }
  function cancelSpotlight() {
    setError(null);
    start(async () => {
      const r = await adminCancelVenueSpotlight(venue.id);
      if (r?.error) setError(r.error);
      else router.refresh();
    });
  }
  function grantEvent(eventId: string, kind: EventPromoKind) {
    setError(null);
    start(async () => {
      const r = await adminGrantEventPromo(eventId, kind, safeDays);
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

  const spotlightDays = daysLeft(venue.spotlight_until);
  const spotlightActive = spotlightDays > 0;

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <div className="card p-3 text-sm text-rose-400">{error}</div>
      )}

      {/* Duration picker */}
      <div className="card p-4 flex items-center gap-3">
        <label htmlFor="days" className="text-sm font-medium">
          Duration:
        </label>
        <input
          id="days"
          type="number"
          min={1}
          max={365}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="w-20 rounded-md bg-buzz-card border border-buzz-border px-2 py-1 text-sm"
        />
        <span className="text-sm text-buzz-mute">days from now</span>
        <span className="ml-auto text-xs text-buzz-mute">
          Applies to anything you activate below.
        </span>
      </div>

      {/* Venue spotlight */}
      <div
        className={`card p-5 ${spotlightActive ? "border-buzz-accent" : ""}`}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="eyebrow text-[10px] mb-1">Venue spotlight</p>
            <h2 className="h-display text-2xl mb-1">🔦 Spotlight venue</h2>
            <p className="text-sm text-buzz-mute max-w-md">
              Featured in the "Spotlight venues" carousel on the home page.
            </p>
          </div>
          <div className="text-right">
            {spotlightActive ? (
              <>
                <div className="text-buzz-accent font-display text-2xl leading-none">
                  {spotlightDays}d left
                </div>
                <button
                  className="btn-secondary mt-2"
                  disabled={pending}
                  onClick={cancelSpotlight}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="btn-primary"
                disabled={pending}
                onClick={grantSpotlight}
              >
                Grant — {safeDays} {safeDays === 1 ? "day" : "days"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Per-gig promos */}
      <div>
        <p className="eyebrow mb-2 mt-2">Per-gig promotions</p>
        {events.length === 0 ? (
          <div className="card p-6 text-buzz-mute">
            No upcoming gigs at this venue.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {events.map((e) => (
              <div key={e.id} className="card p-5">
                <div className="mb-3">
                  <div className="font-display text-xl uppercase truncate">
                    {e.title}
                  </div>
                  <div className="text-xs text-buzz-mute">
                    {formatDateShort(e.start_time)}
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {PROMOS.map((p) => {
                    const col = COLUMN_BY_KIND[p.kind];
                    const left = daysLeft(e[col]);
                    const active = left > 0;
                    return (
                      <div
                        key={p.kind}
                        className={`rounded-lg p-3 border text-sm ${
                          active
                            ? "border-buzz-accent bg-buzz-accent/5"
                            : "border-buzz-border bg-buzz-surface/40"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold flex items-center gap-1.5">
                              <span>{p.emoji}</span> {p.label}
                              {active && (
                                <span className="ml-1 text-xs text-buzz-accent">
                                  · {left}d left
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-buzz-mute mt-0.5">
                              {p.desc}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              active
                                ? cancelEvent(e.id, p.kind)
                                : grantEvent(e.id, p.kind)
                            }
                            className={`shrink-0 text-xs rounded-md px-2 py-1.5 font-semibold transition ${
                              active
                                ? "bg-buzz-card border border-buzz-border hover:border-buzz-accent2 hover:text-buzz-accent2"
                                : "bg-buzz-accent text-black hover:bg-buzz-accent2"
                            }`}
                          >
                            {active
                              ? "Cancel"
                              : `Grant ${safeDays}d`}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-xs text-buzz-mute text-center mt-2">
        Comp promotions don't trigger a Stripe charge. Cancel anytime.
      </div>
    </div>
  );
}
