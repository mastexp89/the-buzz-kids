"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Genre } from "@/lib/types";
import NearMeButton, { SortToggle } from "@/components/NearMeButton";

// Curated list of "popular" genre slugs shown by default. The DB has 25+
// genres and the previous alphabetical slice meant niche genres (Blues,
// Classical) elbowed out the things fans actually filter by (Karaoke,
// Sports, Tribute). Slugs missing from the DB are silently skipped, so
// this stays safe to edit.
// Order matters — chips appear in this order, left to right.
const POPULAR_GENRE_SLUGS = [
  // First 4 also show on mobile — most-filtered things go here.
  "karaoke",
  "covers",
  "acoustic",
  "comedy",
  // Desktop also shows these.
  "electronic",
  "open-mic",
  "sports",
];

// On mobile, only the first N popular chips show by default. The rest
// (popular[N..] + everything else) collapse behind "more". On sm+ the
// full popular row is visible and only the "others" tail hides.
const MOBILE_VISIBLE_COUNT = 4;

const DATE_OPTIONS = [
  { value: "today", label: "Today / Tonight" },
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
            style={{ colorScheme: "dark" }}
            value={customDate || todayIso}
            onChange={(e) => update({ when: e.target.value || "today" })}
            aria-label="Pick a date"
          />
        </div>
      </div>

      <div>
        <div className="label">Genre</div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => update({ genre: null })}
            className={currentGenres.length === 0 ? "chip-accent" : "chip"}
          >
            Any genre
          </button>

          {/* Popular chips. First MOBILE_VISIBLE_COUNT always show. Chips
              past that index are hidden on mobile (until expanded) but
              visible on sm+ at all times. */}
          {popular.map((g, i) => {
            const active = currentGenres.includes(g.slug);
            const mobileHidden = !expanded && i >= MOBILE_VISIBLE_COUNT;
            return (
              <button
                key={g.id}
                onClick={() => toggleGenre(g.slug)}
                className={`${active ? "chip-accent" : "chip"} ${mobileHidden ? "hidden sm:inline-flex" : "inline-flex"}`}
              >
                {g.name}
              </button>
            );
          })}

          {/* Everything else — hidden on every screen size until expanded. */}
          {expanded &&
            others.map((g) => {
              const active = currentGenres.includes(g.slug);
              return (
                <button
                  key={g.id}
                  onClick={() => toggleGenre(g.slug)}
                  className={active ? "chip-accent" : "chip"}
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
