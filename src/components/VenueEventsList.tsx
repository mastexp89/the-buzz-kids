"use client";

import { useState } from "react";
import EventCard from "./EventCard";
import type { EventWithVenue } from "@/lib/types";

const INITIAL = 9;

export default function VenueEventsList({
  events,
  citySlug,
}: {
  events: EventWithVenue[];
  citySlug: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? events : events.slice(0, INITIAL);
  const hidden = events.length - visible.length;

  return (
    <>
      {/* Two columns max on the venue page — the page already has a
          sidebar eating ~320px of horizontal width, so cramming 3 cards
          across the remaining space crushed titles to 3 lines and made
          every card look identical. Two columns gives each card enough
          room for a single-line title in most cases. Homepage / city
          listing pages keep 3 columns (no sidebar, more width). */}
      <div className="grid sm:grid-cols-2 gap-4">
        {visible.map((e) => <EventCard key={e.id} event={e} citySlug={citySlug} />)}
      </div>

      {hidden > 0 && !expanded && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="btn-secondary"
          >
            Show all {events.length} events ↓
          </button>
        </div>
      )}

      {expanded && events.length > INITIAL && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="btn-ghost text-buzz-mute"
          >
            Show less ↑
          </button>
        </div>
      )}
    </>
  );
}
