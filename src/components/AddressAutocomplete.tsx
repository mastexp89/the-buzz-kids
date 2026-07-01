"use client";

// Type-ahead place search for the venue form. Type a place/address, pick the
// right one from Google, and it hands the details back to the form to auto-fill.

import { useState, useEffect, useRef, useTransition } from "react";
import { placeAutocomplete, placeDetails, type PlaceSuggestion, type PlaceDetails } from "@/app/dashboard/venues/place-actions";

export default function AddressAutocomplete({
  onSelect,
}: {
  onSelect: (p: PlaceDetails) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, startSearch] = useTransition();
  const [picking, startPick] = useTransition();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 3) { setResults([]); return; }
    const t = setTimeout(() => {
      startSearch(async () => {
        const r = await placeAutocomplete(q);
        setResults(r.results);
        setOpen(true);
      });
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  // Close the dropdown when clicking away.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-buzz-mute pointer-events-none">🔍</span>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Start typing your place or address…"
          className="input !pl-9"
          autoComplete="off"
        />
        {(searching || picking) && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-buzz-mute">…</span>
        )}
      </div>
      {open && results.length > 0 && (
        <ul className="absolute z-30 mt-1 w-full rounded-lg border border-buzz-border bg-buzz-card shadow-xl max-h-72 overflow-y-auto">
          {results.map((r) => (
            <li key={r.placeId}>
              <button
                type="button"
                disabled={picking}
                onClick={() =>
                  startPick(async () => {
                    const d = await placeDetails(r.placeId);
                    if (d.place) {
                      onSelect(d.place);
                      setQ(d.place.name);
                      setOpen(false);
                    }
                  })
                }
                className="w-full text-left px-3 py-2.5 hover:bg-buzz-surface transition flex flex-col"
              >
                <span className="font-medium text-sm">{r.main}</span>
                {r.secondary && <span className="text-xs text-buzz-mute">{r.secondary}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
