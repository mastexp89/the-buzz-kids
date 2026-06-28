"use client";

// Admin-only panel for re-assigning an event to a different venue.
//
// The actions (moveEventToVenue + searchVenuesForMove) already existed in
// admin-actions.ts — this just surfaces them as a UI on the event edit
// page so admins can fix events that were scraped/imported under the
// wrong venue without having to delete and recreate them.
//
// Renders nothing for non-admin users; the parent page gates this
// component behind its own admin check too.

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveEventToVenue, searchVenuesForMove, type MoveVenueOption } from "./admin-actions";

export default function MoveEventPanel({
  eventId,
  currentVenueId,
  currentVenueName,
}: {
  eventId: string;
  currentVenueId: string;
  currentVenueName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MoveVenueOption[]>([]);
  const [selected, setSelected] = useState<MoveVenueOption | null>(null);
  const [searching, setSearching] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search — fire 250ms after the user stops typing so we
  // don't pummel the action on every keystroke.
  useEffect(() => {
    if (!open) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearching(true);
      searchVenuesForMove(query)
        .then((rows) => {
          // Exclude the current venue from results — moving to itself
          // is a no-op and just clutters the list.
          setResults(rows.filter((r) => r.id !== currentVenueId));
        })
        .finally(() => setSearching(false));
    }, 250);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, open, currentVenueId]);

  function confirmMove() {
    if (!selected) return;
    setError(null);
    const targetName = selected.name + (selected.city ? ` · ${selected.city}` : "");
    if (!confirm(
      `Move this event from "${currentVenueName}" to "${targetName}"?\n\nVisitors browsing the old venue page won't see it anymore.`,
    )) return;
    startTransition(async () => {
      const r = await moveEventToVenue({ eventId, newVenueId: selected.id });
      if ("error" in r) {
        setError(r.error);
        return;
      }
      // Action revalidated both venues' pages and the event page.
      // Bounce to the event detail page on the new venue so the admin
      // can confirm the move visually.
      router.push(`/admin/events`);
    });
  }

  if (!open) {
    return (
      <div className="card p-4 mt-4 border-amber-500/30">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-medium text-sm mb-0.5">Wrong venue?</h3>
            <p className="text-xs text-buzz-mute">
              Move this event to a different venue without deleting and recreating it.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn-secondary text-xs"
          >
            Move to another venue →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-4 mt-4 border-amber-500/40 bg-amber-500/5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="font-medium text-sm">Move event to another venue</h3>
        <button
          type="button"
          onClick={() => { setOpen(false); setSelected(null); setQuery(""); setError(null); }}
          className="text-xs text-buzz-mute hover:text-buzz-fg"
        >
          Cancel
        </button>
      </div>
      <p className="text-xs text-buzz-mute mb-3">
        Currently at <strong className="text-buzz-text">{currentVenueName}</strong>.
        Start typing a target venue name below.
      </p>

      <input
        type="search"
        autoFocus
        value={query}
        onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
        placeholder="Search venues by name…"
        className="input text-sm mb-2"
      />

      {searching && (
        <p className="text-xs text-buzz-mute">Searching…</p>
      )}

      {!searching && results.length === 0 && query.trim().length > 0 && (
        <p className="text-xs text-buzz-mute">
          No venues match &quot;{query}&quot;. Try a shorter / different name.
        </p>
      )}

      {results.length > 0 && (
        <ul className="divide-y divide-buzz-border/60 mb-3 max-h-64 overflow-y-auto">
          {results.map((r) => {
            const isSelected = selected?.id === r.id;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelected(r)}
                  className={
                    "w-full text-left px-3 py-2 text-sm transition " +
                    (isSelected
                      ? "bg-buzz-accent/10 border-l-2 border-buzz-accent"
                      : "hover:bg-buzz-card/60")
                  }
                >
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-buzz-mute">{r.city ?? "—"}</div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p className="text-xs text-rose-400 mb-2">{error}</p>
      )}

      {selected && (
        <div className="flex items-center justify-between gap-3 rounded-md bg-buzz-bg/60 p-2 mt-2">
          <div className="min-w-0 text-sm">
            Move to <strong>{selected.name}</strong>
            {selected.city && <span className="text-buzz-mute"> · {selected.city}</span>}
          </div>
          <button
            type="button"
            onClick={confirmMove}
            disabled={pending}
            className="btn-primary text-xs"
          >
            {pending ? "Moving…" : "Confirm move"}
          </button>
        </div>
      )}
    </div>
  );
}
