"use client";

// Client-side dynamic import for the Leaflet map. Required because
// Leaflet touches `window` at import time, so we can't render it
// during SSR. Next 15 only permits `ssr: false` on next/dynamic
// from inside a client component, so this thin wrapper is needed.

import dynamic from "next/dynamic";
import type { PlannerEvent } from "@/lib/favourites";

const DayPlannerMap = dynamic(() => import("./DayPlannerMap"), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl border border-buzz-border h-[420px] grid place-items-center text-buzz-mute text-sm">
      Loading map…
    </div>
  ),
});

export default function DayPlannerMapWrapper({ events }: { events: PlannerEvent[] }) {
  return <DayPlannerMap events={events} />;
}
