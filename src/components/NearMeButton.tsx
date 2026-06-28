"use client";

import { useNearMe } from "./NearMeContext";

export default function NearMeButton() {
  const { here, loading, error, request, clear } = useNearMe();

  if (here) {
    return (
      <button
        onClick={clear}
        className="chip-accent"
        title="Clear your location"
      >
        📍 Near me ✕
      </button>
    );
  }

  return (
    <button
      onClick={request}
      disabled={loading}
      className="chip"
      title={error ?? "Show distance to each venue"}
    >
      {loading ? "📍 Locating…" : "📍 Near me"}
    </button>
  );
}

// Small inline pill that shows distance — auto-hides if location not yet shared
export function DistancePill({ lat, lng }: { lat: number | null | undefined; lng: number | null | undefined }) {
  const { distanceTo } = useNearMe();
  const d = distanceTo(lat, lng);
  if (!d) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-buzz-mute">
      <span>📍</span>
      <span>{d}</span>
    </span>
  );
}

// Sort by Time / Distance toggle — always visible.
// If the user picks Distance and we don't have their location yet, we ask for it.
export function SortToggle() {
  const { here, loading, sort, setSort, request } = useNearMe();

  function pickDistance() {
    setSort("distance");
    if (!here && !loading) request();
  }

  return (
    <div className="inline-flex items-center gap-2 flex-wrap">
      <span className="text-xs text-buzz-mute uppercase tracking-wider font-semibold">Sort:</span>
      <button
        onClick={() => setSort("time")}
        className={sort === "time" ? "chip-accent" : "chip"}
        title="Earliest first"
      >
        Time
      </button>
      <button
        onClick={pickDistance}
        className={sort === "distance" ? "chip-accent" : "chip"}
        title={here ? "Closest first" : "Sort by distance — uses your location"}
      >
        {sort === "distance" && loading ? "📍 Locating…" : "Distance"}
      </button>
    </div>
  );
}
