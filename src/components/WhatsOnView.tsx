"use client";

import { useMemo, useState } from "react";
import EventCard from "@/components/EventCard";
import AdminDeleteButton from "@/components/AdminDeleteButton";
import type { EventWithVenue } from "@/lib/types";

type City = { name: string; slug: string };
// Pared back to four windows so the page never renders every upcoming event
// at once (which was slow + overwhelming): Today, Tomorrow, This weekend, or a
// specific picked date. There's deliberately no "show everything" option.
type DateFilter = "today" | "tomorrow" | "weekend" | "date";

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

// Range [start, end] for the chosen quick filter, computed in local time.
// Only returns null for the date picker before a date has been chosen.
function rangeFor(filter: DateFilter, picked: string): { start: Date; end: Date } | null {
  const today = new Date();
  const day = today.getDay(); // 0 Sun … 6 Sat
  if (filter === "today") return { start: startOfDay(today), end: endOfDay(today) };
  if (filter === "tomorrow") {
    const tm = new Date(today); tm.setDate(today.getDate() + 1);
    return { start: startOfDay(tm), end: endOfDay(tm) };
  }
  if (filter === "date") {
    if (!picked) return null;
    const d = new Date(picked + "T00:00:00");
    return { start: startOfDay(d), end: endOfDay(d) };
  }
  // weekend
  if (day === 0) return { start: startOfDay(today), end: endOfDay(today) }; // Sunday → just today
  const sat = new Date(today); sat.setDate(today.getDate() + (6 - day));
  const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
  return { start: startOfDay(day === 6 ? today : sat), end: endOfDay(sun) };
}

export default function WhatsOnView({ events, cities, isAdmin }: { events: EventWithVenue[]; cities: City[]; isAdmin?: boolean }) {
  const [filter, setFilter] = useState<DateFilter>("today");
  const [picked, setPicked] = useState("");
  const [area, setArea] = useState("");

  const filtered = useMemo(() => {
    const todayStart = startOfDay(new Date());
    const range = rangeFor(filter, picked);
    return events
      .filter((e) => {
        const start = new Date(e.start_time);
        // Effective end: a multi-day run (end_date) wins, then an explicit
        // end_time, else the event lasts its start day. This is what makes an
        // ongoing exhibition (e.g. 16 May → 2 Aug) show on EVERY day of its
        // run instead of being treated as a one-day event back on its start.
        const endDate = (e as any).end_date as string | null | undefined;
        const end = endDate
          ? endOfDay(new Date(`${endDate}T00:00:00`))
          : e.end_time
          ? new Date(e.end_time)
          : endOfDay(start);
        // Only upcoming / still-running events.
        if (end < todayStart) return false;
        const evCitySlug = (e.venue as any)?.city?.slug ?? (e as any).city?.slug;
        if (area && evCitySlug !== area) return false;
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
            <button onClick={() => { setFilter("today"); }} className={pill(filter === "today")}>Today</button>
            <button onClick={() => { setFilter("tomorrow"); }} className={pill(filter === "tomorrow")}>Tomorrow</button>
            <button onClick={() => { setFilter("weekend"); }} className={pill(filter === "weekend")}>This weekend</button>
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
              : "Nothing on for that day. Try tomorrow, this weekend, or pick another date."}
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((e) => (
            <div key={e.id} className="flex flex-col gap-1.5">
              <EventCard event={e} citySlug={(e.venue as any)?.city?.slug ?? (e as any).city?.slug ?? "dundee"} />
              {isAdmin && <AdminDeleteButton kind="event" id={e.id} name={e.title} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
