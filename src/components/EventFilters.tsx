"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Genre } from "@/lib/types";
import NearMeButton, { SortToggle } from "@/components/NearMeButton";

// Curated "popular" activity-category slugs shown by default. The DB has
// 25+ categories; this surfaces the ones families filter by most. Slugs
// missing from the DB are silently skipped, so this stays safe to edit.
// Order matters — chips appear in this order, left to right.
const POPULAR_GENRE_SLUGS = [
  // First 4 also show on mobile — most-filtered things go here.
  "soft-play",
  "holiday-club",
  "farm-animals",
  "arts-crafts",
  // Desktop also shows these.
  "sports-camp",
  "theatre",
  "days-out",
];

// On mobile, only the first N popular chips show by default. The rest
// (popular[N..] + everything else) collapse behind "more". On sm+ the
// full popular row is visible and only the "others" tail hides.
const MOBILE_VISIBLE_COUNT = 4;

// Pill colours from The Buzz Kids logo. Category chips cycle through these
// so the filter row reads playful/colourful rather than all-gold. Each
// entry carries the solid fill (active state) + a soft tint (resting state).
const CHIP_COLOURS = [
  { solid: "#EC1E8C", on: "#ffffff", tintBg: "#FBE0EC", tintText: "#A3174F" }, // pink
  { solid: "#1FA9E0", on: "#ffffff", tintBg: "#DCF1FA", tintText: "#0C6087" }, // cyan
  { solid: "#6FA713", on: "#ffffff", tintBg: "#E6F6E0", tintText: "#3B6D11" }, // lime
  { solid: "#F9A11B", on: "#1F1B16", tintBg: "#FFEDC2", tintText: "#854F0B" }, // gold
];

function chipStyle(i: number, active: boolean): React.CSSProperties {
  const c = CHIP_COLOURS[i % CHIP_COLOURS.length];
  return active
    ? { backgroundColor: c.solid, color: c.on, borderColor: c.solid }
    : { backgroundColor: c.tintBg, color: c.tintText, borderColor: "transparent" };
}

const DATE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "weekend", label: "This weekend" },
  { value: "week", label: "This week" },
  { value: "all", label: "All upcoming" },
];

export default function EventFilters({ genres }: { genres: Genre[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const currentDate = params.get("when") || "today";
  const currentGenres = (params.get("genre") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const customDate = /^\d{4}-\d{2}-\d{2}$/.test(currentDate) ? currentDate : "";

  // Split into popular (curated, in our order) + others (whatever's left,
  // alphabetical because that's how the parent fetches them).
  const popular = POPULAR_GENRE_SLUGS
    .map((slug) => genres.find((g) => g.slug === slug))
    .filter((g): g is Genre => Boolean(g));
  const others = genres.filter((g) => !POPULAR_GENRE_SLUGS.includes(g.slug));

  // Auto-expand if any currently-selected genre lives outside the popular
  // chips — otherwise it'd be invisible until the user opens "more".
  const initiallyExpanded =
    currentGenres.length > 0 &&
    others.some((g) => currentGenres.includes(g.slug));
  const [expanded, setExpanded] = useState(initiallyExpanded);

  // Today as YYYY-MM-DD in the user's local timezone, populated client-side
  // only to avoid SSR / hydration mismatches.
  const [todayIso, setTodayIso] = useState("");
  useEffect(() => {
    const d = new Date();
    setTodayIso(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
  }, []);

  function update(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") sp.delete(k);
      else sp.set(k, v);
    }
    router.push(`${pathname}?${sp.toString()}`);
  }

  function toggleGenre(slug: string) {
    const next = currentGenres.includes(slug)
      ? currentGenres.filter((g) => g !== slug)
      : [...currentGenres, slug];
    update({ genre: next.length ? next.join(",") : null });
  }

  return (
    <div className="card p-4 flex flex-col gap-3">
      <div>
        <div className="label">When</div>
        <div className="flex flex-wrap gap-2">
          {DATE_OPTIONS.map((opt) => {
            const active = currentDate === opt.value && !customDate;
            return (
              <button
                key={opt.value}
                onClick={() => update({ when: opt.value })}
                className={active ? "chip-accent" : "chip"}
              >
                {opt.label}
              </button>
            );
          })}
          <input
            type="date"
            // !py-1 and !text-xs override the global .input class's px-3.5
            // py-2.5 / text-base so the date matches chip height. Same on
            // mobile + desktop — the input was overshadowing the chips
            // sitting beside it.
            className="input max-w-[160px] !py-1 !px-2 !text-xs"
            style={{ colorScheme: "light" }}
            value={customDate || todayIso}
            onChange={(e) => update({ when: e.target.value || "today" })}
            aria-label="Pick a date"
          />
        </div>
      </div>

      <div>
        <div className="label">Activity</div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => update({ genre: null })}
            className={currentGenres.length === 0 ? "chip-accent" : "chip"}
          >
            Any activity
          </button>

          {/* Popular chips. First MOBILE_VISIBLE_COUNT always show. Chips
              past that index are hidden on mobile (until expanded) but
              visible on sm+ at all times. Each chip takes a colour from the
              logo palette (by overall index) so the row stays colourful. */}
          {popular.map((g, i) => {
            const active = currentGenres.includes(g.slug);
            const mobileHidden = !expanded && i >= MOBILE_VISIBLE_COUNT;
            return (
              <button
                key={g.id}
                onClick={() => toggleGenre(g.slug)}
                style={chipStyle(i, active)}
                className={`chip ${mobileHidden ? "hidden sm:inline-flex" : "inline-flex"}`}
              >
                {g.name}
              </button>
            );
          })}

          {/* Everything else — hidden on every screen size until expanded. */}
          {expanded &&
            others.map((g, j) => {
              const active = currentGenres.includes(g.slug);
              return (
                <button
                  key={g.id}
                  onClick={() => toggleGenre(g.slug)}
                  style={chipStyle(popular.length + j, active)}
                  className="chip"
                >
                  {g.name}
                </button>
              );
            })}

          {others.length > 0 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="chip text-buzz-accent border-buzz-accent/40"
            >
              {expanded ? "Show less ▴" : `+${others.length} more ▾`}
            </button>
          )}

          {currentGenres.length > 1 && (
            <button
              onClick={() => update({ genre: null })}
              className="chip text-buzz-mute"
              title="Clear all selected genres"
            >
              Clear ({currentGenres.length})
            </button>
          )}
        </div>
      </div>

      <div>
        <div className="label">Distance</div>
        <div className="flex flex-wrap gap-2 items-center">
          <NearMeButton />
          <SortToggle />
        </div>
      </div>
    </div>
  );
}
