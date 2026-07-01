"use client";

// Compact horizontal filter bar (the "IKEA style" chips that open a sheet),
// replacing the tall stacked PlaceFilters card. Same URL params, so nothing
// downstream changes — it just reads/writes loc, open, cat, access, toddler,
// rain, outdoor, free, other exactly like PlaceFilters did.
//
// Layout: a scroll-x row of category chips. Tapping one opens a panel —
// a bottom sheet on mobile, a dropdown under the bar on desktop — with that
// category's options. Active chips go pink with a count so it's obvious what's
// applied (offsetting the "filters are behind a tap" trade-off).

import { useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Genre } from "@/lib/types";
import { ACCESS_FACETS } from "@/lib/accessibility";

// Categories not useful for this directory (mirrors PlaceFilters).
const EXCLUDED_NAMES = new Set([
  "story time from library",
  "music and singing",
  "seasonal and festive",
  "stem and coding",
  "drama and performance",
]);

type CatKey = "area" | "open" | "activity" | "access" | "more";
type City = { name: string; slug: string };

const PINK = "#EC1E8C";

function openDayLabel(open: string): string {
  if (open === "any") return "Any day";
  if (open === "tomorrow") return "Tomorrow";
  if (open === "weekend") return "This weekend";
  if (/^\d{4}-\d{2}-\d{2}$/.test(open)) {
    const d = new Date(`${open}T00:00:00`);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  return "Today";
}

export default function PlaceFilterBar({
  genres,
  cities,
}: {
  genres: Genre[];
  cities?: City[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [openPanel, setOpenPanel] = useState<CatKey | null>(null);

  const cats = (params.get("cat") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const access = (params.get("access") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const locs = (params.get("loc") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const toddler = params.get("toddler") === "1";
  const rain = params.get("rain") === "1";
  const outdoor = params.get("outdoor") === "1";
  const free = params.get("free") === "1";
  const other = params.get("other") === "1";
  const dog = params.get("dog") === "1";
  const open = params.get("open") || "today";
  const openIsDate = /^\d{4}-\d{2}-\d{2}$/.test(open);

  function update(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") sp.delete(k);
      else sp.set(k, v);
    }
    router.push(`${pathname}?${sp.toString()}`, { scroll: false });
  }
  const toggleIn = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  const allCities = cities ?? [];
  const visibleGenres = genres.filter(
    (g) => !EXCLUDED_NAMES.has(g.name.toLowerCase()) || cats.includes(g.slug),
  );

  const activityCount = cats.length + (other ? 1 : 0);
  const moreCount = [toddler, free, rain, outdoor, dog].filter(Boolean).length;
  const anyFilter = locs.length > 0 || activityCount > 0 || access.length > 0 || moreCount > 0 || open !== "today";

  const chips: { key: CatKey; label: string; active: boolean; show: boolean }[] = [
    { key: "open", label: openDayLabel(open), active: open !== "today", show: true },
    { key: "area", label: locs.length ? `Area · ${locs.length}` : "Area", active: locs.length > 0, show: allCities.length > 0 },
    { key: "activity", label: activityCount ? `Activity · ${activityCount}` : "Activity", active: activityCount > 0, show: true },
    { key: "access", label: access.length ? `Access · ${access.length}` : "Access", active: access.length > 0, show: true },
    { key: "more", label: moreCount ? `More · ${moreCount}` : "More", active: moreCount > 0, show: true },
  ];

  function close() { setOpenPanel(null); }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
        {chips.filter((c) => c.show).map((c) => (
          <button
            key={c.key}
            onClick={() => setOpenPanel(openPanel === c.key ? null : c.key)}
            className={"shrink-0 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium border transition whitespace-nowrap " +
              (c.active ? "" : "bg-transparent border-buzz-border text-buzz-text hover:border-buzz-accent")}
            style={c.active ? { backgroundColor: PINK, color: "#fff", borderColor: PINK } : undefined}
          >
            {c.label}
            <span className={`text-xs ${c.active ? "opacity-80" : "text-buzz-mute"}`}>▾</span>
          </button>
        ))}
        {anyFilter && (
          <button
            onClick={() => { update({ cat: null, access: null, toddler: null, rain: null, outdoor: null, free: null, other: null, dog: null, loc: null, open: null }); close(); }}
            className="shrink-0 rounded-full px-3 py-2 text-sm font-medium text-buzz-accent hover:underline whitespace-nowrap"
          >
            Clear all
          </button>
        )}
      </div>

      {openPanel && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 sm:bg-transparent" onClick={close} aria-hidden />
          <div className="z-50 fixed inset-x-0 bottom-0 max-h-[80vh] rounded-t-2xl border-t sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:left-0 sm:mt-2 sm:w-[44rem] sm:max-w-[92vw] sm:max-h-[34rem] sm:rounded-2xl sm:border bg-buzz-card border-buzz-border overflow-y-auto shadow-xl">
            <div className="sticky top-0 bg-buzz-card flex items-center justify-between px-4 py-3 border-b border-buzz-border/60">
              <span className="font-display text-lg uppercase">{panelTitle(openPanel)}</span>
              <button onClick={close} aria-label="Close" className="text-buzz-mute hover:text-buzz-text text-xl leading-none">✕</button>
            </div>
            <div className="p-4 flex flex-wrap gap-2">
              {renderPanel()}
            </div>
            <div className="sticky bottom-0 bg-buzz-card border-t border-buzz-border/60 px-4 py-3 flex justify-end">
              <button onClick={close} className="btn-primary">Done</button>
            </div>
          </div>
        </>
      )}
    </div>
  );

  function renderPanel() {
    if (openPanel === "open") {
      return (
        <>
          <Pill active={open === "today"} onClick={() => update({ open: null })}>Today</Pill>
          <Pill active={open === "tomorrow"} onClick={() => update({ open: "tomorrow" })}>Tomorrow</Pill>
          <label className={pillClass(openIsDate) + " cursor-pointer"}>
            📅 {openIsDate ? openDayLabel(open) : "Pick a date"}
            <input
              type="date"
              value={openIsDate ? open : ""}
              onChange={(e) => update({ open: e.target.value || null })}
              className="ml-2 bg-transparent outline-none text-xs"
            />
          </label>
        </>
      );
    }
    if (openPanel === "area") {
      return (
        <>
          <Pill active={locs.length === 0} onClick={() => update({ loc: null })}>Everywhere</Pill>
          {allCities.map((c) => (
            <Pill key={c.slug} active={locs.includes(c.slug)} onClick={() => update({ loc: toggleIn(locs, c.slug).join(",") || null })}>
              {c.name}
            </Pill>
          ))}
        </>
      );
    }
    if (openPanel === "activity") {
      return (
        <>
          <Pill active={cats.length === 0 && !other} onClick={() => update({ cat: null, other: null })}>Anything</Pill>
          {visibleGenres.map((g) => (
            <Pill key={g.id} active={cats.includes(g.slug)} onClick={() => update({ cat: toggleIn(cats, g.slug).join(",") || null, other: null })}>
              {g.name}
            </Pill>
          ))}
          <Pill active={other} onClick={() => update({ other: other ? null : "1", cat: null })}>Other</Pill>
        </>
      );
    }
    if (openPanel === "access") {
      return ACCESS_FACETS.map((f) => (
        <Pill key={f.key} active={access.includes(f.key)} onClick={() => update({ access: toggleIn(access, f.key).join(",") || null })}>
          <span className="mr-1" aria-hidden>{f.icon}</span>{f.label}
        </Pill>
      ));
    }
    // more
    return (
      <>
        <Pill active={toddler} onClick={() => update({ toddler: toddler ? null : "1" })}>🧸 Toddler-friendly</Pill>
        <Pill active={free} onClick={() => update({ free: free ? null : "1" })}>💷 Free entry</Pill>
        <Pill active={rain} onClick={() => update({ rain: rain ? null : "1", outdoor: null })}>🌧️ Rainy day</Pill>
        <Pill active={outdoor} onClick={() => update({ outdoor: outdoor ? null : "1", rain: null })}>☀️ Sunny day</Pill>
        <Pill active={dog} onClick={() => update({ dog: dog ? null : "1" })}>🐶 Dog friendly</Pill>
      </>
    );
  }
}

function panelTitle(k: CatKey): string {
  return { open: "Open", area: "Area", activity: "Activity", access: "Access & sensory", more: "Handy filters" }[k];
}

function pillClass(active: boolean): string {
  return `filter-pill ${active ? "filter-pill-active" : ""}`;
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={pillClass(active)}>
      {children}
    </button>
  );
}
