"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Genre } from "@/lib/types";
import { ACCESS_FACETS } from "@/lib/accessibility";

// Colourful category pills (logo palette), matching the What's-on filters.
const CHIP_COLOURS = [
  { solid: "#EC1E8C", on: "#fff", tintBg: "#FBE0EC", tintText: "#A3174F" },
  { solid: "#1FA9E0", on: "#fff", tintBg: "#DCF1FA", tintText: "#0C6087" },
  { solid: "#6FA713", on: "#fff", tintBg: "#E6F6E0", tintText: "#3B6D11" },
  { solid: "#F9A11B", on: "#1F1B16", tintBg: "#FFEDC2", tintText: "#854F0B" },
];
function chipStyle(i: number, active: boolean): React.CSSProperties {
  const c = CHIP_COLOURS[i % CHIP_COLOURS.length];
  return active
    ? { backgroundColor: c.solid, color: c.on, borderColor: c.solid }
    : { backgroundColor: c.tintBg, color: c.tintText, borderColor: "transparent" };
}

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

  const cats = (params.get("cat") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const access = (params.get("access") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const toddler = params.get("toddler") === "1";
  const rain = params.get("rain") === "1";
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

  return (
    <div className="card p-4 flex flex-col gap-5">
      {cities && cities.length > 0 && (
        <div>
          <div className="label mb-2">Area</div>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
            <button onClick={() => update({ loc: null })} className={`filter-pill shrink-0 ${loc === "" ? "filter-pill-active" : ""}`}>
              Everywhere
            </button>
            {cities.map((c) => (
              <button
                key={c.slug}
                onClick={() => update({ loc: loc === c.slug ? null : c.slug })}
                className={`filter-pill shrink-0 ${loc === c.slug ? "filter-pill-active" : ""}`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="label mb-2">Activity</div>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
          <button onClick={() => update({ cat: null })} className={`filter-pill shrink-0 ${cats.length === 0 ? "filter-pill-active" : ""}`}>
            Anything
          </button>
          {genres.map((g, i) => {
            const active = cats.includes(g.slug);
            const c = CHIP_COLOURS[i % CHIP_COLOURS.length];
            return (
              <button
                key={g.id}
                onClick={() => update({ cat: toggleIn(cats, g.slug).join(",") || null })}
                className="filter-pill shrink-0"
                style={active
                  ? { backgroundColor: c.solid, color: c.on, borderColor: c.solid }
                  : { backgroundColor: c.tintBg, color: c.tintText, borderColor: "transparent" }}
              >
                {g.name}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="label mb-2">Handy filters</div>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
          <button
            onClick={() => update({ toddler: toddler ? null : "1" })}
            className={`filter-pill shrink-0 ${toddler ? "filter-pill-active" : ""}`}
          >
            🧸 Toddler-friendly
          </button>
          <button
            onClick={() => update({ rain: rain ? null : "1" })}
            className={`filter-pill shrink-0 ${rain ? "filter-pill-active" : ""}`}
          >
            🌧️ Rainy day
          </button>
        </div>
      </div>

      <div>
        <div className="label mb-2">Access &amp; sensory needs</div>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
          {ACCESS_FACETS.map((f) => {
            const active = access.includes(f.key);
            return (
              <button
                key={f.key}
                onClick={() => update({ access: toggleIn(access, f.key).join(",") || null })}
                className={`filter-pill shrink-0 ${active ? "filter-pill-active" : ""}`}
              >
                <span aria-hidden className="mr-1">{f.icon}</span>
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {(cats.length > 0 || access.length > 0 || toddler || rain || loc) && (
        <button
          onClick={() => update({ cat: null, access: null, toddler: null, rain: null, loc: null })}
          className="filter-pill self-start text-buzz-mute"
        >
          ✕ Clear all filters
        </button>
      )}
    </div>
  );
}
