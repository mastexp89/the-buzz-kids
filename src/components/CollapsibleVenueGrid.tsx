"use client";

import { useState } from "react";
import VenueCard from "./VenueCard";
import type { Venue } from "@/lib/types";

const INITIAL_COUNT = 12;

export default function CollapsibleVenueGrid({
  venues,
  citySlug,
}: {
  venues: Venue[];
  citySlug: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? venues : venues.slice(0, INITIAL_COUNT);
  const hiddenCount = Math.max(0, venues.length - INITIAL_COUNT);

  return (
    <>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {visible.map((v) => (
          <VenueCard key={v.id} venue={v} citySlug={citySlug} />
        ))}
      </div>
      {hiddenCount > 0 && (
        <div className="mt-5 text-center">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="btn-secondary"
          >
            {expanded ? "Show less ▴" : `Show all ${venues.length} venues ▾`}
          </button>
        </div>
      )}
    </>
  );
}
