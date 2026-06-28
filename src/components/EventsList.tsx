"use client";

import { useMemo } from "react";
import EventCard from "./EventCard";
import { useNearMe } from "./NearMeContext";
import { ordinal } from "@/lib/utils";
import type { EventWithVenue } from "@/lib/types";

export default function EventsList({
  events,
  citySlug,
  groupByDay,
  groups,
}: {
  events: EventWithVenue[];
  citySlug: string;
  groupByDay?: boolean;
  groups?: { day: string; date: Date; items: EventWithVenue[] }[];
}) {
  const { here, sort, rawDistanceTo } = useNearMe();

  // Sort by distance if user has shared location AND chosen distance sort
  const sortedEvents = useMemo(() => {
    if (!here || sort !== "distance") return events;
    return [...events].sort((a, b) => {
      const da = rawDistanceTo((a.venue as any).latitude, (a.venue as any).longitude);
      const db = rawDistanceTo((b.venue as any).latitude, (b.venue as any).longitude);
      // Venues without coords sink to bottom
      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    });
  }, [events, here, sort, rawDistanceTo]);

  if (groupByDay && groups && (!here || sort !== "distance")) {
    // Day-grouped view (only when not sorting by distance)
    return (
      <div className="flex flex-col gap-10">
        {groups.map(({ day, date, items }) => (
          <div key={day}>
            <h3 className="font-display text-2xl uppercase mb-4 flex items-baseline gap-3">
              <span className="text-buzz-accent">{shortDayLabel(date)}</span>
              <span className="text-buzz-mute text-sm font-sans normal-case font-medium">
                {longDayLabel(date)}
              </span>
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {items.map((e) => (
                <EventCard key={e.id} event={e} citySlug={citySlug} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {sortedEvents.map((e) => (
        <EventCard key={e.id} event={e} citySlug={citySlug} />
      ))}
    </div>
  );
}

function shortDayLabel(d: Date) {
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  if (isToday) return "Today";
  if (isTomorrow) return "Tomorrow";
  return d.toLocaleDateString("en-GB", { weekday: "long" });
}

function longDayLabel(d: Date) {
  // "30th May" — drop-in ordinal upgrade over the previous
  // `{ day: "numeric", month: "long" }` formatter.
  const day = d.getDate();
  const month = d.toLocaleDateString("en-GB", { month: "long" });
  return `${day}${ordinal(day)} ${month}`;
}
