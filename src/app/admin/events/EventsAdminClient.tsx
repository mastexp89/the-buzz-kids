"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import {
  searchAllEvents,
  searchVenuesForFilter,
  type EventSearchResult,
  type AdminVenueOption,
} from "./actions";

type WhenFilter = "upcoming" | "past" | "all";
type StatusFilter = "approved" | "pending" | "rejected" | "all";

export default function EventsAdminClient() {
  const [query, setQuery] = useState("");
  const [when, setWhen] = useState<WhenFilter>("upcoming");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [venueId, setVenueId] = useState<string | null>(null);
  const [venueLabel, setVenueLabel] = useState<string>("");
  const [results, setResults] = useState<EventSearchResult[]>([]);
  const [totalMatching, setTotalMatching] = useState(0);
  const [capApplied, setCapApplied] = useState(0);
  const [loading, startTransition] = useTransition();

  // Run search whenever any filter changes (debounced for the text input)
  useEffect(() => {
    const t = setTimeout(() => {
      startTransition(async () => {
        const r = await searchAllEvents({ query, when, status, venueId });
        setResults(r.results);
        setTotalMatching(r.totalMatching);
        setCapApplied(r.capApplied);
      });
    }, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [query, when, status, venueId]);

  return (
    <div className="flex flex-col gap-4">
      {/* Filter row */}
      <div className="card p-4 flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            placeholder="Search by title…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input flex-1"
          />
          <VenuePicker
            value={venueId}
            label={venueLabel}
            onChange={(id, name) => { setVenueId(id); setVenueLabel(name); }}
          />
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <FilterPill active={when === "upcoming"} onClick={() => setWhen("upcoming")}>Upcoming</FilterPill>
          <FilterPill active={when === "past"} onClick={() => setWhen("past")}>Past</FilterPill>
          <FilterPill active={when === "all"} onClick={() => setWhen("all")}>All time</FilterPill>
          <span className="text-buzz-mute mx-1">·</span>
          <FilterPill active={status === "all"} onClick={() => setStatus("all")}>Any status</FilterPill>
          <FilterPill active={status === "approved"} onClick={() => setStatus("approved")}>Approved</FilterPill>
          <FilterPill active={status === "pending"} onClick={() => setStatus("pending")}>Pending</FilterPill>
          <FilterPill active={status === "rejected"} onClick={() => setStatus("rejected")}>Rejected</FilterPill>
        </div>
      </div>

      {/* Results */}
      <div className="text-xs text-buzz-mute">
        {loading
          ? "Searching…"
          : results.length < totalMatching
          ? `Showing first ${results.length} of ${totalMatching} matching · narrow the filters to see the rest (cap ${capApplied})`
          : `${totalMatching} result${totalMatching === 1 ? "" : "s"}`}
      </div>

      {results.length === 0 && !loading && (
        <div className="card p-10 text-center text-buzz-mute">
          No events match those filters. Try clearing the search or expanding to <strong>All time</strong>.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {results.map((e) => (
          <EventRow key={e.id} event={e} />
        ))}
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

function VenuePicker({
  value,
  label,
  onChange,
}: {
  value: string | null;
  label: string;
  onChange: (id: string | null, name: string) => void;
}) {
  const [query, setQuery] = useState(label);
  const [results, setResults] = useState<AdminVenueOption[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      if (query.trim().length === 0) {
        setResults([]);
        return;
      }
      const r = await searchVenuesForFilter(query);
      if (!cancelled) setResults(r);
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  if (value) {
    return (
      <div className="rounded-lg border border-buzz-accent/50 bg-buzz-accent/10 px-3 py-2 flex items-center justify-between gap-2 sm:w-[280px]">
        <div className="min-w-0 truncate text-sm">📍 {label}</div>
        <button
          type="button"
          onClick={() => { onChange(null, ""); setQuery(""); }}
          className="text-xs text-buzz-mute hover:text-buzz-accent shrink-0"
        >
          Clear
        </button>
      </div>
    );
  }

  return (
    <div className="relative sm:w-[280px]">
      <input
        type="text"
        placeholder="Filter by place…"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="input"
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg bg-buzz-card border border-buzz-border shadow-lg overflow-hidden max-h-72 overflow-y-auto">
          {results.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => { onChange(v.id, v.name); setQuery(v.name); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-buzz-surface"
            >
              <div className="font-medium">{v.name}</div>
              <div className="text-[10px] text-buzz-mute">{v.city ?? "—"}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ event }: { event: EventSearchResult }) {
  const isPast = new Date(event.start_time).getTime() < Date.now();
  return (
    <div className="card p-3 flex items-center gap-3">
      {event.image_url ? (
        <div
          className="w-14 h-14 rounded bg-buzz-surface shrink-0 border border-buzz-border"
          style={{ backgroundImage: `url(${event.image_url})`, backgroundSize: "cover", backgroundPosition: "center" }}
        />
      ) : (
        <div className="w-14 h-14 rounded bg-buzz-surface shrink-0 border border-buzz-border grid place-items-center text-xl text-buzz-mute">
          🎵
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-display text-base uppercase truncate">{event.title}</div>
          {event.cancelled && <span className="text-[10px] text-rose-400 uppercase font-bold">cancelled</span>}
          {event.status && event.status !== "approved" && (
            <span className="text-[10px] text-buzz-accent uppercase font-bold">{event.status}</span>
          )}
          {event.auto_imported_from && (
            <span className="text-[10px] text-buzz-mute">via {event.auto_imported_from}</span>
          )}
        </div>
        <div className="text-xs text-buzz-mute mt-0.5">
          <span className={isPast ? "opacity-60" : ""}>{formatWhen(event.start_time)}</span>
          {event.venue && (
            <>
              {" · "}
              <span className="text-buzz-text">{event.venue.name}</span>
              {event.venue.city && <span> · {event.venue.city}</span>}
            </>
          )}
          {event.artists.length > 0 && (
            <span className="text-buzz-mute"> · {event.artists.slice(0, 3).join(", ")}{event.artists.length > 3 && ` +${event.artists.length - 3}`}</span>
          )}
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        {event.venue && (
          <Link
            href={`/dashboard/venues/${event.venue.id}/events/${event.id}/edit`}
            className="btn-primary text-xs py-1"
          >
            Edit
          </Link>
        )}
        {event.venue && (
          <Link
            href={`/${event.venue.city ? "dundee" : "dundee"}/events/${event.id}`}
            target="_blank"
            className="btn-secondary text-xs py-1"
          >
            View ↗
          </Link>
        )}
      </div>
    </div>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
