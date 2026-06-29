"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
}: {
  venues: Venue[];
  pending?: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Client-side search across name, town and address.
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

  if (venues.length === 0) return null;

  return (
    <div className="card overflow-hidden">
      {/* Search */}
      <div className="px-4 pt-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, town or postcode…"
          className="input w-full"
        />
      </div>
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
              ? (query ? `${filtered.length} of ${venues.length}` : `Select all (${venues.length})`)
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
