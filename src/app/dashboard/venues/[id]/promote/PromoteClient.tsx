"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelEventPromo,
  cancelVenueSpotlight,
} from "./actions";

type PromoKind = "featured" | "highlighted" | "genre_takeover" | "weekend_boost";

// Maps the old client-side kind names to the Stripe API kind names
const STRIPE_KIND: Record<PromoKind, string> = {
  featured: "featured_pin",
  highlighted: "highlighted_gig",
  genre_takeover: "genre_takeover",
  weekend_boost: "weekend_boost",
};

const COLUMN_BY_KIND: Record<PromoKind, "featured_until" | "highlighted_until" | "genre_takeover_until" | "weekend_boost_until"> = {
  featured: "featured_until",
  highlighted: "highlighted_until",
  genre_takeover: "genre_takeover_until",
  weekend_boost: "weekend_boost_until",
};

const PROMOS: { kind: PromoKind; emoji: string; label: string; desc: string; price: string }[] = [
  { kind: "featured",        emoji: "📌", label: "Pin to top",     desc: "Pin to the top of /dundee for 7 days.",                         price: "£10" },
  { kind: "highlighted",     emoji: "⭐", label: "Highlight",       desc: "Yellow border + glow in listings for 7 days.",                  price: "£5"  },
  { kind: "genre_takeover",  emoji: "🎚️", label: "Genre takeover", desc: "Jump to the top when fans filter by your genres for 7 days.", price: "£8"  },
  { kind: "weekend_boost",   emoji: "🔥", label: "Weekend boost",  desc: "Big WEEKEND PICK badge on the gig — best for Fri/Sat shows.",    price: "£6"  },
];

function daysLeft(iso: string | null) {
  if (!iso) return 0;
  const ms = new Date(iso).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / (24 * 60 * 60 * 1000)) : 0;
}

function formatDateShort(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export default function PromoteClient({
  venue,
  events,
}: {
  venue: any;
  events: any[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function buyEventPromo(eventId: string, kind: PromoKind) {
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout/promotion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueId: venue.id, kind: STRIPE_KIND[kind], eventId }),
      });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json.error ?? "Could not start checkout");
      window.location.href = json.url;
    } catch (e: any) {
      setError(e.message);
    }
  }

  function cancelEventPromoFn(eventId: string, kind: PromoKind) {
    setError(null);
    start(async () => {
      const res = await cancelEventPromo(eventId, kind);
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  }

  async function buySpotlight() {
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout/promotion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueId: venue.id, kind: "spotlight" }),
      });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json.error ?? "Could not start checkout");
      window.location.href = json.url;
    } catch (e: any) {
      setError(e.message);
    }
  }

  function cancelSpotlight() {
    setError(null);
    start(async () => {
      const res = await cancelVenueSpotlight(venue.id);
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  }

  const spotlightActive = daysLeft(venue.spotlight_until) > 0;
  const spotlightDays = daysLeft(venue.spotlight_until);

  return (
    <div className="flex flex-col gap-5">
      {error && <div className="card p-3 text-sm text-rose-400">{error}</div>}

      {/* Venue spotlight */}
      <div className={`card p-5 ${spotlightActive ? "border-buzz-accent" : ""}`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="eyebrow text-[10px] mb-1">Venue spotlight</p>
            <h2 className="h-display text-2xl mb-1">🔦 Spotlight your venue</h2>
            <p className="text-sm text-buzz-mute max-w-md">
              Featured in the "Spotlight venues" carousel on the home page for 7 days.
            </p>
          </div>
          <div className="text-right">
            {spotlightActive ? (
              <>
                <div className="text-buzz-accent font-display text-2xl leading-none">{spotlightDays}d left</div>
                <button className="btn-secondary mt-2" disabled={pending} onClick={cancelSpotlight}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="btn-primary" disabled={pending} onClick={buySpotlight}>
                Activate — £15 / 7 days
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
            You don't have any upcoming gigs yet. Add one and you'll be able to promote it here.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {events.map((e) => (
              <div key={e.id} className="card p-5">
                <div className="mb-3">
                  <div className="font-display text-xl uppercase truncate">{e.title}</div>
                  <div className="text-xs text-buzz-mute">{formatDateShort(e.start_time)}</div>
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {PROMOS.map((p) => {
                    const col = COLUMN_BY_KIND[p.kind];
                    const days = daysLeft(e[col]);
                    const active = days > 0;
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
                                <span className="ml-1 text-xs text-buzz-accent">· {days}d left</span>
                              )}
                            </div>
                            <p className="text-xs text-buzz-mute mt-0.5">{p.desc}</p>
                          </div>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => active ? cancelEventPromoFn(e.id, p.kind) : buyEventPromo(e.id, p.kind)}
                            className={`shrink-0 text-xs rounded-md px-2 py-1.5 font-semibold transition ${
                              active
                                ? "bg-buzz-card border border-buzz-border hover:border-buzz-accent2 hover:text-buzz-accent2"
                                : "bg-buzz-accent text-black hover:bg-buzz-accent2"
                            }`}
                          >
                            {active ? "Cancel" : `Buy — ${p.price}`}
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
        Each promotion runs for 7 days from purchase. Cancel anytime — no refunds for unused time.
      </div>
    </div>
  );
}
