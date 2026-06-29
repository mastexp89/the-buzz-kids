"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import AdminVenueRow from "./AdminVenueRow";
import {
  bulkApproveVenues,
  bulkUnapproveVenues,
  bulkDeleteVenues,
} from "./actions";

type Venue = {
  id: string;
  name: string;
  [k: string]: any;
};

export default function AdminVenueList({
  venues,
  pending,
  searchable,
  initialQuery,
}: {
  venues: Venue[];
  pending?: boolean;
  searchable?: boolean;
  initialQuery?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [busy, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery ?? "");

  // Server-side search: push ?q= (debounced) so the result set covers the
  // WHOLE table, not just the ~1000 rows this page loaded. The local filter
  // below still narrows instantly as you type for snappy feedback.
  const firstRun = useRef(true);
  useEffect(() => {
    if (!searchable) return;
    if (firstRun.current) { firstRun.current = false; return; }
    const t = setTimeout(() => {
      const sp = new URLSearchParams(params.toString());
      const q = query.trim();
      if (q) sp.set("q", q); else sp.delete("q");
      router.push(`${pathname}?${sp.toString()}`, { scroll: false });
    }, 350);
    return () => clearTimeout(t);
  }, [query, searchable]); // eslint-disable-line react-hooks/exhaustive-deps

  // Instant local filter over the loaded rows (name / town / postcode / address).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return venues;
    return venues.filter((v) => {
      const hay = `${v.name ?? ""} ${v.city?.name ?? ""} ${v.address ?? ""} ${v.postcode ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [venues, query]);

  const allIds = useMemo(() => filtered.map((v) => v.id), [filtered]);
  const allSelected = selected.size > 0 && selected.size === allIds.length;
  const someSelected = selected.size > 0 && !allSelected;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function bulk(action: "approve" | "unapprove" | "delete") {
    setError(null);
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    if (action === "delete") {
      const ok = confirm(
        `Permanently delete ${ids.length} place${ids.length === 1 ? "" : "s"} and all of their events?\n\n` +
          `This cannot be undone.`,
      );
      if (!ok) return;
    }

    start(async () => {
      const fn =
        action === "approve" ? bulkApproveVenues
        : action === "unapprove" ? bulkUnapproveVenues
        : bulkDeleteVenues;
      const r = await fn(ids);
      if ("error" in r && r.error) {
        setError(r.error);
      } else {
        clearSelection();
        router.refresh();
      }
    });
  }

  // Keep the search box mounted even with zero rows (so a no-match search
  // can still be cleared); only bail entirely for a non-searchable empty list.
  if (venues.length === 0 && !searchable) return null;

  return (
    <div className="card overflow-hidden">
      {searchable && (
        <div className="px-4 pt-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all places by name, town or postcode…"
            className="input w-full"
            autoComplete="off"
          />
        </div>
      )}
      {/* Toolbar — sticky at the top of the list when scrolling a long list */}
      <div className="px-4 py-3 border-b border-buzz-border/60 bg-buzz-surface/40 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer text-sm select-none">
          <input
            type="checkbox"
            className="w-4 h-4 accent-buzz-accent"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={toggleAll}
          />
          <span className="text-buzz-mute">
            {selected.size === 0
              ? (query.trim() ? `${filtered.length} result${filtered.length === 1 ? "" : "s"}` : `Select all (${venues.length})`)
              : `${selected.size} of ${filtered.length} selected`}
          </span>
        </label>

        {selected.size > 0 && (
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            {pending ? (
              <button
                type="button"
                onClick={() => bulk("approve")}
                disabled={busy}
                className="btn-primary text-sm py-1.5"
              >
                {busy ? "…" : `Approve ${selected.size}`}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => bulk("unapprove")}
                disabled={busy}
                className="btn-secondary text-sm py-1.5"
              >
                {busy ? "…" : `Unapprove ${selected.size}`}
              </button>
            )}
            <button
              type="button"
              onClick={() => bulk("delete")}
              disabled={busy}
              className="btn-danger text-sm py-1.5"
            >
              {busy ? "…" : `Delete ${selected.size}`}
            </button>
            <button
              type="button"
              onClick={clearSelection}
              disabled={busy}
              className="btn-ghost text-sm py-1.5"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="px-4 py-2 text-sm text-rose-400 border-b border-buzz-border/60">
          {error}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-buzz-mute">No places match “{query}”.</div>
      ) : (
        <ul className="divide-y divide-buzz-border/60">
          {filtered.map((v) => (
            <AdminVenueRow
              key={v.id}
              venue={v}
              pending={pending}
              selected={selected.has(v.id)}
              onToggleSelect={() => toggleOne(v.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
