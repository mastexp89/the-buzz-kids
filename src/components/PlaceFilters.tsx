"use client";

import { useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Genre } from "@/lib/types";
import { ACCESS_FACETS } from "@/lib/accessibility";

// Categories removed from the activity filter (not useful for this directory).
const EXCLUDED_NAMES = new Set([
  "story time from library",
  "music and singing",
  "seasonal and festive",
  "stem and coding",
  "drama and performance",
]);

const CHIP_COLOURS = [
  { solid: "#EC1E8C", on: "#fff", tintBg: "#FBE0EC", tintText: "#A3174F" },
  { solid: "#1FA9E0", on: "#fff", tintBg: "#DCF1FA", tintText: "#0C6087" },
  { solid: "#6FA713", on: "#fff", tintBg: "#E6F6E0", tintText: "#3B6D11" },
  { solid: "#F9A11B", on: "#1F1B16", tintBg: "#FFEDC2", tintText: "#854F0B" },
];

const INITIAL_VISIBLE = 4;

export default function PlaceFilters({
  genres,
  cities,
}: {
  genres: Genre[];
  cities?: { name: string; slug: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [showAllCats, setShowAllCats] = useState(false);
  const [showAllAccess, setShowAllAccess] = useState(false);

  const cats = (params.get("cat") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const access = (params.get("access") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const toddler = params.get("toddler") === "1";
  const rain = params.get("rain") === "1";
  const outdoor = params.get("outdoor") === "1";
  const free = params.get("free") === "1";
  const loc = params.get("loc") || "";

  function update(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") sp.delete(k);
      else sp.set(k, v);
    }
    router.push(`${pathname}?${sp.toString()}`);
  }
  const toggleIn = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  const hasFilters = cats.length > 0 || access.length > 0 || toddler || rain || outdoor || free || loc;
  const clearAll = () => update({ cat: null, access: null, toddler: null, rain: null, outdoor: null, free: null, loc: null });

  // Filter out excluded categories, keeping any that are currently active so
  // a URL-shared filter still shows the active pill even if it's "hidden".
  const visibleGenres = genres.filter(
    (g) => !EXCLUDED_NAMES.has(g.name.toLowerCase()) || cats.includes(g.slug),
  );
  const shownGenres = showAllCats ? visibleGenres : visibleGenres.slice(0, INITIAL_VISIBLE);
  const hiddenCatCount = visibleGenres.length - INITIAL_VISIBLE;

  const shownAccess = showAllAccess ? ACCESS_FACETS : ACCESS_FACETS.slice(0, INITIAL_VISIBLE);
  const hiddenAccessCount = ACCESS_FACETS.length - INITIAL_VISIBLE;

  return (
    <div className="card p-4 flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <span className="label">Filters</span>
        {hasFilters && (
          <button onClick={clearAll} className="text-xs text-buzz-accent hover:underline font-medium">
            Clear all
          </button>
        )}
      </div>

      {cities && cities.length > 0 && (
        <div>
          <div className="label mb-2">Area</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => update({ loc: null })} className={`filter-pill ${loc === "" ? "filter-pill-active" : ""}`}>
              Everywhere
            </button>
            {cities.map((c) => (
              <button
                key={c.slug}
                onClick={() => update({ loc: loc === c.slug ? null : c.slug })}
                className={`filter-pill ${loc === c.slug ? "filter-pill-active" : ""}`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="label mb-2">Activity</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => update({ cat: null })} className={`filter-pill ${cats.length === 0 ? "filter-pill-active" : ""}`}>
            Anything
          </button>
          {shownGenres.map((g, i) => {
            const active = cats.includes(g.slug);
            const c = CHIP_COLOURS[i % CHIP_COLOURS.length];
            return (
              <button
                key={g.id}
                onClick={() => update({ cat: toggleIn(cats, g.slug).join(",") || null })}
                className="filter-pill"
                style={active
                  ? { backgroundColor: c.solid, color: c.on, borderColor: c.solid }
                  : { backgroundColor: c.tintBg, color: c.tintText, borderColor: "transparent" }}
              >
                {g.name}
              </button>
            );
          })}
          {!showAllCats && hiddenCatCount > 0 && (
            <button
              onClick={() => setShowAllCats(true)}
              className="filter-pill text-buzz-mute"
            >
              +{hiddenCatCount} more
            </button>
          )}
          {showAllCats && visibleGenres.length > INITIAL_VISIBLE && (
            <button
              onClick={() => setShowAllCats(false)}
              className="filter-pill text-buzz-mute"
            >
              Show less
            </button>
          )}
        </div>
      </div>

      <div>
        <div className="label mb-2">Handy filters</div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => update({ toddler: toddler ? null : "1" })}
            className={`filter-pill ${toddler ? "filter-pill-active" : ""}`}
          >
            🧸 Toddler-friendly
          </button>
          <button
            onClick={() => update({ free: free ? null : "1" })}
            className={`filter-pill ${free ? "filter-pill-active" : ""}`}
          >
            💷 Free entry
          </button>
          <button
            onClick={() => update({ rain: rain ? null : "1", outdoor: null })}
            className={`filter-pill ${rain ? "filter-pill-active" : ""}`}
          >
            🌧️ Rainy day
          </button>
          <button
            onClick={() => update({ outdoor: outdoor ? null : "1", rain: null })}
            className={`filter-pill ${outdoor ? "filter-pill-active" : ""}`}
          >
            ☀️ Sunny day
          </button>
        </div>
      </div>

      <div>
        <div className="label mb-2">Access &amp; sensory needs</div>
        <div className="flex flex-wrap gap-2">
          {shownAccess.map((f) => {
            const active = access.includes(f.key);
            return (
              <button
                key={f.key}
                onClick={() => update({ access: toggleIn(access, f.key).join(",") || null })}
                className={`filter-pill ${active ? "filter-pill-active" : ""}`}
              >
                <span aria-hidden className="mr-1">{f.icon}</span>
                {f.label}
              </button>
            );
          })}
          {!showAllAccess && hiddenAccessCount > 0 && (
            <button
              onClick={() => setShowAllAccess(true)}
              className="filter-pill text-buzz-mute"
            >
              +{hiddenAccessCount} more
            </button>
          )}
          {showAllAccess && ACCESS_FACETS.length > INITIAL_VISIBLE && (
            <button
              onClick={() => setShowAllAccess(false)}
              className="filter-pill text-buzz-mute"
            >
              Show less
            </button>
          )}
        </div>
      </div>

      {hasFilters && (
        <button onClick={clearAll} className="filter-pill self-start text-buzz-mute border-buzz-border">
          ✕ Clear all filters
        </button>
      )}
    </div>
  );
}
