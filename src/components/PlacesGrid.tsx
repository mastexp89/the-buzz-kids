"use client";

// Renders the places grid with an optional "near me / within X miles"
// distance filter. Location lives only in the browser (free geolocation),
// so this is a client wrapper; distance is pure maths on the lat/lng we
// already store — no API, no cost.

import { useState, useEffect } from "react";
import PlaceCard from "@/components/PlaceCard";
import AdminDeleteButton from "@/components/AdminDeleteButton";
import { useNearMe } from "@/components/NearMeContext";
import { formatDistance } from "@/lib/geocode";

const RADII = [1, 3, 5, 10, 25, 50]; // miles
// Show this many places at first, then reveal more a page at a time. The full
// list can be 1,500+, which is a huge DOM and a wall of cards — rendering it
// all at once is the main cause of the slow paint on browse/city pages.
const INITIAL_CAP = 24;
const PAGE = 24;

export default function PlacesGrid({ places, isAdmin }: { places: any[]; isAdmin?: boolean }) {
  const { here, loading, error, request, clear, rawDistanceTo } = useNearMe();
  const [radius, setRadius] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_CAP);

  // When we have a location, attach distance, optionally filter by radius,
  // and sort nearest-first. Places without coords sink to the bottom.
  let shown = places;
  let withCoords = places.length;
  if (here) {
    const tagged = places.map((p) => ({ p, d: rawDistanceTo(p.latitude, p.longitude) }));
    withCoords = tagged.filter((x) => x.d != null).length;
    const filtered = radius == null ? tagged : tagged.filter((x) => x.d != null && x.d <= radius);
    filtered.sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity));
    shown = filtered.map((x) => ({ ...x.p, _distance: x.d }));
  }

  // Reset back to the first page whenever the filter set changes (turning
  // location on/off or picking a radius) so a new list starts at the top.
  useEffect(() => { setVisibleCount(INITIAL_CAP); }, [here, radius]);

  // Only render up to visibleCount cards; "Load more" reveals another page.
  // The count summaries above still reflect the full filtered set.
  const visible = shown.slice(0, visibleCount);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {!here ? (
          <button
            onClick={request}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-full border-2 border-buzz-accent text-buzz-accent font-bold px-5 py-2.5 hover:bg-buzz-accent hover:text-white transition disabled:opacity-60"
            title="Find places near you"
          >
            {loading ? "📍 Locating…" : "📍 Places near me"}
          </button>
        ) : (
          <>
            <span className="text-sm text-buzz-mute font-semibold uppercase tracking-wider mr-1">Within</span>
            <button onClick={() => setRadius(null)} className={radius == null ? "chip-accent" : "chip"}>Any</button>
            {RADII.map((r) => (
              <button key={r} onClick={() => setRadius(r)} className={radius === r ? "chip-accent" : "chip"}>
                {r} mi
              </button>
            ))}
            <button onClick={() => { clear(); setRadius(null); }} className="chip text-buzz-mute" title="Clear your location">
              📍 ✕
            </button>
          </>
        )}
        {error && <span className="text-xs text-rose-400">{error}</span>}
        {here && (
          <span className="text-sm text-buzz-mute ml-auto">
            {radius == null
              ? `Nearest first · ${withCoords} place${withCoords === 1 ? "" : "s"}`
              : `${shown.length} place${shown.length === 1 ? "" : "s"} within ${radius} mi`}
          </span>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-3">📍</div>
          <h2 className="h-display text-3xl mb-2">Nothing this close</h2>
          <p className="text-buzz-mute max-w-md mx-auto">Try a wider range, or set it back to “Any”.</p>
        </div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {visible.map((p: any) => (
              <div key={p.id} className="flex flex-col gap-1.5 h-full">
                <div className="relative flex-1">
                  {here && p._distance != null && (
                    <span className="absolute top-2 left-2 z-10 inline-flex items-center gap-1 rounded-full bg-black/65 text-white text-[11px] font-semibold px-2 py-1 backdrop-blur-sm">
                      📍 {formatDistance(p._distance)}
                    </span>
                  )}
                  <PlaceCard place={p} citySlug={p.city?.slug ?? "dundee"} />
                </div>
                {isAdmin && <AdminDeleteButton kind="place" id={p.id} name={p.name} />}
              </div>
            ))}
          </div>

          {visibleCount < shown.length && (
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <button onClick={() => setVisibleCount((v) => v + PAGE)} className="btn-primary">
                Load more <span className="opacity-80">({shown.length - visibleCount} to go)</span>
              </button>
              <button onClick={() => setVisibleCount(shown.length)} className="btn-secondary">
                Show all {shown.length}
              </button>
            </div>
          )}
          {visibleCount >= shown.length && shown.length > INITIAL_CAP && (
            <div className="mt-8 text-center">
              <button onClick={() => setVisibleCount(INITIAL_CAP)} className="btn-secondary">
                Show fewer
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
