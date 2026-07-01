"use client";

import { useMemo, useState } from "react";
import EventCard from "@/components/EventCard";
import AdminDeleteButton from "@/components/AdminDeleteButton";
import type { EventWithVenue } from "@/lib/types";
import { isRecurring, recurrenceOccursInWindow } from "@/lib/recurrence";

type City = { name: string; slug: string };
// Pared back to four windows so the page never renders every upcoming event
// at once (which was slow + overwhelming): Today, Tomorrow, This weekend, or a
// specific picked date. There's deliberately no "show everything" option.
type DateFilter = "today" | "tomorrow" | "weekend" | "date" | "upcoming";

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

// Range [start, end] for the chosen quick filter, computed in local time.
// Only returns null for the date picker before a date has been chosen.
function rangeFor(filter: DateFilter, picked: string): { start: Date; end: Date } | null {
  const today = new Date();
  const day = today.getDay(); // 0 Sun … 6 Sat
  // "Any date" — no window, so every upcoming/ongoing event shows (the filter
  // still drops anything that has already finished). Lets people find things
  // that aren't today, like a holiday camp a fortnight away.
  if (filter === "upcoming") return null;
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
  // weekend = Friday → Sunday. Families plan the whole weekend, and Friday
  // clubs / after-school sessions are part of it — so a "every Friday" Bookbug
  // or a Fri-only event shows under "This weekend" too (previously Sat+Sun only,
  // which hid Friday events and confused people).
  const daysUntilSun = (7 - day) % 7;               // Wed→4, Fri→2, Sat→1, Sun→0
  const sun = new Date(today); sun.setDate(today.getDate() + daysUntilSun);
  const fri = new Date(sun); fri.setDate(sun.getDate() - 2);
  const start = today > fri ? today : fri;          // already into the weekend → start from today
  return { start: startOfDay(start), end: endOfDay(sun) };
}

export default function WhatsOnView({ events, cities, isAdmin }: { events: EventWithVenue[]; cities: City[]; isAdmin?: boolean }) {
  const [filter, setFilter] = useState<DateFilter>("today");
  const [picked, setPicked] = useState("");
  const [area, setArea] = useState("");
  const [openPanel, setOpenPanel] = useState<"when" | "area" | null>(null);

  const filtered = useMemo(() => {
    const todayStart = startOfDay(new Date());
    const range = rangeFor(filter, picked);
    return events
      .filter((e) => {
        const start = new Date(e.start_time);
        const evCitySlug = (e.venue as any)?.city?.slug ?? (e as any).city?.slug;
        if (area && evCitySlug !== area) return false;

        // Recurring series (e.g. "every Friday"): show it on every day its
        // pattern lands on, not just the start date. The window is always set
        // (default Today) except an empty date picker, where we just show it.
        const rec = (e as any).recurrence_pattern as string | null | undefined;
        const recUntil = (e as any).recurrence_until as string | null | undefined;
        if (isRecurring(rec)) {
          if (recUntil && endOfDay(new Date(`${recUntil}T00:00:00`)) < todayStart) return false; // series ended
          if (!range) return true;
          const winStart = range.start < todayStart ? todayStart : range.start;
          return recurrenceOccursInWindow(rec, e.start_time, recUntil ?? null, winStart, range.end);
        }

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
        if (range) {
          // Overlap test between the event and the chosen window.
          if (start > range.end || end < range.start) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  }, [events, filter, picked, area]);

  const pill = (active: boolean) => `filter-pill ${active ? "filter-pill-active" : ""}`;

  const PINK = "#EC1E8C";
  const whenLabel =
    filter === "tomorrow" ? "Tomorrow"
    : filter === "upcoming" ? "Any date"
    : filter === "weekend" ? "This weekend"
    : filter === "date" && picked ? new Date(`${picked}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : "Today";
  const areaLabel = area ? (cities.find((c) => c.slug === area)?.name ?? "Area") : "Area";

  return (
    <div>
      {/* Filter chips — same compact pattern as the Places tab */}
      <div className="relative mb-8">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setOpenPanel(openPanel === "when" ? null : "when")}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium border whitespace-nowrap"
            style={{ backgroundColor: PINK, color: "#fff", borderColor: PINK }}
          >
            {whenLabel} <span className="text-xs opacity-80">▾</span>
          </button>
          {cities.length > 1 && (
            <button
              onClick={() => setOpenPanel(openPanel === "area" ? null : "area")}
              className={"shrink-0 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium border whitespace-nowrap " +
                (area ? "" : "bg-transparent border-buzz-border text-buzz-text hover:border-buzz-accent")}
              style={area ? { backgroundColor: PINK, color: "#fff", borderColor: PINK } : undefined}
            >
              {area ? areaLabel : "Area"} <span className={`text-xs ${area ? "opacity-80" : "text-buzz-mute"}`}>▾</span>
            </button>
          )}
        </div>

        {openPanel && (
          <>
            <div className="fixed inset-0 z-40 bg-black/40 sm:bg-transparent" onClick={() => setOpenPanel(null)} aria-hidden />
            <div className="z-50 fixed inset-x-0 bottom-0 max-h-[80vh] rounded-t-2xl border-t sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:left-0 sm:mt-2 sm:w-[30rem] sm:max-w-[90vw] sm:max-h-[26rem] sm:rounded-2xl sm:border bg-buzz-card border-buzz-border overflow-y-auto shadow-xl">
              <div className="sticky top-0 bg-buzz-card flex items-center justify-between px-4 py-3 border-b border-buzz-border/60">
                <span className="font-display text-lg uppercase">{openPanel === "when" ? "When" : "Area"}</span>
                <button onClick={() => setOpenPanel(null)} aria-label="Close" className="text-buzz-mute hover:text-buzz-text text-xl leading-none">✕</button>
              </div>
              <div className="p-4 flex flex-wrap gap-2">
                {openPanel === "when" ? (
                  <>
                    <button onClick={() => setFilter("today")} className={pill(filter === "today")}>Today</button>
                    <button onClick={() => setFilter("tomorrow")} className={pill(filter === "tomorrow")}>Tomorrow</button>
                    <button onClick={() => setFilter("weekend")} className={pill(filter === "weekend")}>This weekend</button>
                    <button onClick={() => setFilter("upcoming")} className={pill(filter === "upcoming")}>Any date</button>
                    <label className={pill(filter === "date") + " cursor-pointer"}>
                      📅 {filter === "date" && picked ? whenLabel : "Pick a date"}
                      <input
                        type="date"
                        value={picked}
                        onChange={(e) => { setPicked(e.target.value); setFilter("date"); }}
                        className="ml-2 bg-transparent outline-none text-xs"
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <button onClick={() => setArea("")} className={pill(area === "")}>Everywhere</button>
                    {cities.map((c) => (
                      <button key={c.slug} onClick={() => setArea(area === c.slug ? "" : c.slug)} className={pill(area === c.slug)}>
                        {c.name}
                      </button>
                    ))}
                  </>
                )}
              </div>
              <div className="sticky bottom-0 bg-buzz-card border-t border-buzz-border/60 px-4 py-3 flex justify-end">
                <button onClick={() => setOpenPanel(null)} className="btn-primary">Done</button>
              </div>
            </div>
          </>
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
            <div key={e.id} className="flex flex-col gap-1.5 h-full">
              <div className="flex-1">
                <EventCard event={e} citySlug={(e.venue as any)?.city?.slug ?? (e as any).city?.slug ?? "dundee"} />
              </div>
              {isAdmin && <AdminDeleteButton kind="event" id={e.id} name={e.title} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
