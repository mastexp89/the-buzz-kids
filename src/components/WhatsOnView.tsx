"use client";

import { useMemo, useState } from "react";
import EventCard from "@/components/EventCard";
import type { EventWithVenue } from "@/lib/types";

type City = { name: string; slug: string };
type DateFilter = "all" | "weekend" | "week" | "month" | "date";

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

// Range [start, end] for the chosen quick filter, computed in local time.
function rangeFor(filter: DateFilter, picked: string): { start: Date; end: Date } | null {
  const today = new Date();
  const day = today.getDay(); // 0 Sun … 6 Sat
  if (filter === "all") return null;
  if (filter === "date") {
    if (!picked) return null;
    const d = new Date(picked + "T00:00:00");
    return { start: startOfDay(d), end: endOfDay(d) };
  }
  if (filter === "weekend") {
    if (day === 0) return { start: startOfDay(today), end: endOfDay(today) }; // Sunday → just today
    const sat = new Date(today); sat.setDate(today.getDate() + (6 - day));
    const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
    return { start: startOfDay(day === 6 ? today : sat), end: endOfDay(sun) };
  }
  if (filter === "week") {
    const sun = new Date(today); sun.setDate(today.getDate() + ((7 - day) % 7));
    return { start: startOfDay(today), end: endOfDay(sun) };
  }
  // month
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { start: startOfDay(today), end: endOfDay(end) };
}

export default function WhatsOnView({ events, cities }: { events: EventWithVenue[]; cities: City[] }) {
  const [filter, setFilter] = useState<DateFilter>("all");
  const [picked, setPicked] = useState("");
  const [area, setArea] = useState("");

  const filtered = useMemo(() => {
    const todayStart = startOfDay(new Date());
    const range = rangeFor(filter, picked);
    return events
      .filter((e) => {
        const start = new Date(e.start_time);
        const end = e.end_time ? new Date(e.end_time) : endOfDay(start);
        // Only upcoming / still-running events.
        if (end < todayStart) return false;
        if (area && (e.venue as any)?.city?.slug !== area) return false;
        if (range) {
          // Overlap test between the event and the chosen window.
          if (start > range.end || end < range.start) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  }, [events, filter, picked, area]);

  const pill = (active: boolean) => `filter-pill ${active ? "filter-pill-active" : ""}`;

  return (
    <div>
      {/* Date filters */}
      <div className="card p-4 flex flex-col gap-4 mb-8">
        <div>
          <div className="label mb-2">When</div>
          <div className="flex flex-wrap gap-2 items-center">
            <button onClick={() => { setFilter("all"); }} className={pill(filter === "all")}>Anytime</button>
            <button onClick={() => { setFilter("weekend"); }} className={pill(filter === "weekend")}>This weekend</button>
            <button onClick={() => { setFilter("week"); }} className={pill(filter === "week")}>This week</button>
            <button onClick={() => { setFilter("month"); }} className={pill(filter === "month")}>This month</button>
            <label className={pill(filter === "date") + " cursor-pointer"}>
              📅 Pick a date
              <input
                type="date"
                value={picked}
                onChange={(e) => { setPicked(e.target.value); setFilter("date"); }}
                className="ml-2 bg-transparent outline-none text-xs"
              />
            </label>
          </div>
        </div>

        {cities.length > 1 && (
          <div>
            <div className="label mb-2">Area</div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setArea("")} className={pill(area === "")}>Everywhere</button>
              {cities.map((c) => (
                <button key={c.slug} onClick={() => setArea(area === c.slug ? "" : c.slug)} className={pill(area === c.slug)}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-3">📅</div>
          <h2 className="h-display text-3xl mb-2">Nothing on just now</h2>
          <p className="text-buzz-mute max-w-md mx-auto">
            {events.length === 0
              ? "We're just getting started — events, fayres and holiday fun will appear here soon."
              : "No events match that filter. Try 'Anytime' or a different area."}
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((e) => (
            <EventCard key={e.id} event={e} citySlug={(e.venue as any)?.city?.slug ?? "dundee"} />
          ))}
        </div>
      )}
    </div>
  );
}
