"use client";

// Bulk venue cover-photo entry. One row per venue, each with a URL input
// that downloads + persists the image when submitted.

import { useState } from "react";
import { setVenueCoverFromUrl, clearVenueCoverPhoto, type FestivalVenuePhotoRow } from "./actions";

type RowState = {
  url: string;
  busy: boolean;
  message: string | null;
  messageType: "ok" | "error" | null;
};

export default function VenuePhotosClient({
  festivalId,
  initialVenues,
}: {
  festivalId: string;
  initialVenues: FestivalVenuePhotoRow[];
}) {
  const [venues, setVenues] = useState(initialVenues);
  const [filter, setFilter] = useState<"all" | "missing" | "set">("missing");
  const [search, setSearch] = useState("");
  const [rowState, setRowState] = useState<Record<string, RowState>>({});

  function update(venueId: string, patch: Partial<RowState>) {
    setRowState((prev) => {
      const current: RowState = prev[venueId] ?? { url: "", busy: false, message: null, messageType: null };
      return { ...prev, [venueId]: { ...current, ...patch } };
    });
  }

  async function save(venueId: string) {
    const url = rowState[venueId]?.url ?? "";
    if (!url.trim()) return;
    update(venueId, { busy: true, message: null, messageType: null });
    const r = await setVenueCoverFromUrl({ venueId, url });
    if ("error" in r) {
      update(venueId, { busy: false, message: r.error, messageType: "error" });
      return;
    }
    update(venueId, { busy: false, message: "Saved ✓", messageType: "ok", url: "" });
    setVenues((prev) =>
      prev.map((v) => (v.id === venueId ? { ...v, cover_photo_url: r.publicUrl } : v)),
    );
  }

  async function clear(venueId: string) {
    if (!confirm("Remove the current cover photo? You can paste a new one any time.")) return;
    const r = await clearVenueCoverPhoto(venueId);
    if ("error" in r) {
      update(venueId, { message: r.error, messageType: "error" });
      return;
    }
    setVenues((prev) =>
      prev.map((v) => (v.id === venueId ? { ...v, cover_photo_url: null } : v)),
    );
    update(venueId, { message: "Cleared", messageType: "ok" });
  }

  const filtered = venues.filter((v) => {
    if (filter === "missing" && v.cover_photo_url) return false;
    if (filter === "set" && !v.cover_photo_url) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!v.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const missingCount = venues.filter((v) => !v.cover_photo_url).length;
  const setCount = venues.filter((v) => v.cover_photo_url).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap text-xs">
          <FilterPill active={filter === "missing"} onClick={() => setFilter("missing")}>
            Missing ({missingCount})
          </FilterPill>
          <FilterPill active={filter === "set"} onClick={() => setFilter("set")}>
            Set ({setCount})
          </FilterPill>
          <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
            All ({venues.length})
          </FilterPill>
        </div>
        <input
          type="text"
          placeholder="Filter by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input text-sm w-full sm:w-64"
        />
      </div>

      {filtered.length === 0 && (
        <div className="card p-10 text-center text-buzz-mute text-sm">
          {filter === "missing" ? "🎉 Every venue has a cover photo!" : "No venues match."}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {filtered.map((v) => {
          const state = rowState[v.id];
          return (
            <div key={v.id} className="card p-3 flex items-center gap-3">
              {/* Current image preview */}
              <div className="w-20 h-14 rounded bg-buzz-surface border border-buzz-border shrink-0 overflow-hidden">
                {(v.cover_photo_url || v.logo_url) ? (
                  <div
                    className="w-full h-full"
                    style={{
                      backgroundImage: `url(${v.cover_photo_url || v.logo_url})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center text-2xl text-buzz-mute">🐝</div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="font-medium text-sm truncate">{v.name}</div>
                  {v.cover_photo_url ? (
                    <span className="text-[10px] text-emerald-400 uppercase font-bold">cover set</span>
                  ) : (
                    <span className="text-[10px] text-buzz-accent uppercase font-bold">missing</span>
                  )}
                  {v.facebook && (
                    <a href={v.facebook} target="_blank" rel="noopener noreferrer" className="text-[10px] text-buzz-mute hover:text-buzz-accent">
                      FB ↗
                    </a>
                  )}
                  {v.website && (
                    <a href={v.website} target="_blank" rel="noopener noreferrer" className="text-[10px] text-buzz-mute hover:text-buzz-accent">
                      Site ↗
                    </a>
                  )}
                </div>
                <div className="flex gap-2 mt-1">
                  <input
                    type="url"
                    placeholder="Paste image URL…"
                    value={state?.url ?? ""}
                    onChange={(e) => update(v.id, { url: e.target.value, message: null, messageType: null })}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(v.id); } }}
                    disabled={state?.busy}
                    className="input text-xs flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => save(v.id)}
                    disabled={state?.busy || !state?.url?.trim()}
                    className="btn-primary text-xs whitespace-nowrap py-1"
                  >
                    {state?.busy ? "…" : "Use URL"}
                  </button>
                  {v.cover_photo_url && (
                    <button
                      type="button"
                      onClick={() => clear(v.id)}
                      disabled={state?.busy}
                      className="text-xs text-rose-400 hover:text-rose-300 px-2"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {state?.message && (
                  <div className={`text-[11px] mt-1 ${state.messageType === "error" ? "text-rose-400" : "text-emerald-400"}`}>
                    {state.message}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded-full border ${active
        ? "border-buzz-accent bg-buzz-accent/15 text-buzz-text font-bold"
        : "border-buzz-border bg-buzz-surface text-buzz-mute hover:text-buzz-text"
      }`}
    >
      {children}
    </button>
  );
}
