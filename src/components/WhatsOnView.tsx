"use client";

import { useMemo, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import EventCard from "@/components/EventCard";
import AdminDeleteButton from "@/components/AdminDeleteButton";
import ConvertEventToOfferButton from "@/components/ConvertEventToOfferButton";
import WeatherStrip, { type WeatherArea } from "@/components/WeatherStrip";
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

const WHEN_FILTERS: DateFilter[] = ["today", "tomorrow", "weekend", "upcoming"];

export default function WhatsOnView({ events, cities, isAdmin }: { events: EventWithVenue[]; cities: City[]; isAdmin?: boolean }) {
  const searchParams = useSearchParams();
  // Seed the filters from the URL so returning from an event page (router.back)
  // — or opening a shared link — keeps the date + area you had.
  const initWhen = searchParams.get("when") ?? "today";
  const initIsDate = /^\d{4}-\d{2}-\d{2}$/.test(initWhen);
  const [filter, setFilter] = useState<DateFilter>(
    initIsDate ? "date" : (WHEN_FILTERS.includes(initWhen as DateFilter) ? (initWhen as DateFilter) : "today"),
  );
  const [picked, setPicked] = useState(initIsDate ? initWhen : "");
  // Multi-select areas (comma-separated in the URL). Empty = everywhere.
  const [areas, setAreas] = useState<string[]>(
    () => (searchParams.get("area") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  );
  const [openPanel, setOpenPanel] = useState<"when" | "area" | null>(null);
  // Render the grid a page at a time — painting hundreds of event cards at
  // once is what made the tab feel slow. Resets when the filters change.
  const PAGE_SIZE = 21;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [filter, picked, areas]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleArea(slug: string) {
    setAreas((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
  }

  // Mirror the current filters into the URL (query only, no navigation/refetch)
  // so back/forward and shared links preserve them.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", "events");
    const whenVal = filter === "date" ? picked : filter;
    if (whenVal && whenVal !== "today") params.set("when", whenVal);
    else params.delete("when");
    if (areas.length) params.set("area", areas.join(","));
    else params.delete("area");
    const qs = params.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    window.history.replaceState(window.history.state, "", url);
  }, [filter, picked, areas]);

  const filtered = useMemo(() => {
    const todayStart = startOfDay(new Date());
    const range = rangeFor(filter, picked);
    return events
      .filter((e) => {
        const start = new Date(e.start_time);
        const evCitySlug = (e.venue as any)?.city?.slug ?? (e as any).city?.slug;
        if (areas.length && !areas.includes(evCitySlug)) return false;

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
  }, [events, filter, picked, areas]);

  // Weather: centre of each selected area, averaged from its events' venue
  // coords (cities don't store coords). Shown only when 1–3 areas are picked —
  // "Everywhere" has no meaningful single forecast.
  const weatherAreas: WeatherArea[] = useMemo(() => {
    if (areas.length === 0) return [];
    const sums = new Map<string, { lat: number; lon: number; n: number }>();
    for (const e of events) {
      const v = e.venue as any;
      const slug = v?.city?.slug ?? (e as any).city?.slug;
      if (!slug || !areas.includes(slug)) continue;
      const lat = Number(v?.latitude), lon = Number(v?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const s = sums.get(slug) ?? { lat: 0, lon: 0, n: 0 };
      s.lat += lat; s.lon += lon; s.n++;
      sums.set(slug, s);
    }
    return areas
      .map((slug) => {
        const s = sums.get(slug);
        if (!s || s.n === 0) return null;
        return {
          label: cities.find((c) => c.slug === slug)?.name ?? slug,
          lat: s.lat / s.n,
          lon: s.lon / s.n,
        };
      })
      .filter(Boolean) as WeatherArea[];
  }, [areas, events, cities]);

  // The date window being browsed, as local YYYY-MM-DD, for the forecast.
  const fmtDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const weatherRange = useMemo(() => {
    const r = rangeFor(filter, picked);
    if (r) return { start: fmtDay(r.start), end: fmtDay(r.end) };
    // "Any date" (or no date picked yet): show the next 5 days.
    const today = new Date();
    const end = new Date(today); end.setDate(today.getDate() + 4);
    return { start: fmtDay(today), end: fmtDay(end) };
  }, [filter, picked]);

  const pill = (active: boolean) => `filter-pill ${active ? "filter-pill-active" : ""}`;

  const PINK = "#EC1E8C";
  const whenLabel =
    filter === "tomorrow" ? "Tomorrow"
    : filter === "upcoming" ? "Any date"
    : filter === "weekend" ? "This weekend"
    : filter === "date" && picked ? new Date(`${picked}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : "Today";
  const areaLabel =
    areas.length === 0 ? "Area"
    : areas.length === 1 ? (cities.find((c) => c.slug === areas[0])?.name ?? "Area")
    : `${areas.length} areas`;

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
                (areas.length ? "" : "bg-transparent border-buzz-border text-buzz-text hover:border-buzz-accent")}
              style={areas.length ? { backgroundColor: PINK, color: "#fff", borderColor: PINK } : undefined}
            >
              {areaLabel} <span className={`text-xs ${areas.length ? "opacity-80" : "text-buzz-mute"}`}>▾</span>
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
                    <button onClick={() => setAreas([])} className={pill(areas.length === 0)}>Everywhere</button>
                    {cities.map((c) => (
                      <button key={c.slug} onClick={() => toggleArea(c.slug)} className={pill(areas.includes(c.slug))}>
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

      {/* Weather for the browsed dates — one row per selected area (max 3). */}
      {weatherAreas.length > 0 && (
        <WeatherStrip areas={weatherAreas} startDate={weatherRange.start} endDate={weatherRange.end} />
      )}

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
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.slice(0, visibleCount).map((e) => (
              <div key={e.id} className="flex flex-col gap-1.5 h-full">
                <div className="flex-1">
                  <EventCard event={e} citySlug={(e.venue as any)?.city?.slug ?? (e as any).city?.slug ?? "dundee"} />
                </div>
                {isAdmin && (
                  <>
                    <ConvertEventToOfferButton eventId={e.id} eventTitle={e.title} />
                    <AdminDeleteButton kind="event" id={e.id} name={e.title} />
                  </>
                )}
              </div>
            ))}
          </div>
          {visibleCount < filtered.length && (
            <div className="mt-8 text-center">
              <button onClick={() => setVisibleCount((v) => v + PAGE_SIZE)} className="btn-primary">
                Show more <span className="opacity-80">({filtered.length - visibleCount} to go)</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
