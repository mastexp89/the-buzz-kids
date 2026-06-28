"use client";

// Chip-based artist editor with type-ahead.
// - Each artist becomes a removable chip.
// - Typing fetches matching existing artists from the DB (debounced).
// - Pressing Enter adds the typed name as a NEW artist (resolved on publish).
// - Click an existing match to add it as an existing artist link.

import { useEffect, useRef, useState } from "react";
import { searchArtists, type ArtistOption, type ArtistRef } from "@/app/admin/quick-import/actions";

export type ChipArtist =
  | { kind: "existing"; id: string; name: string }
  | { kind: "new"; name: string };

export function chipArtistToRef(c: ChipArtist): ArtistRef {
  return c.kind === "existing" ? { id: c.id } : { name: c.name };
}

export default function ArtistChipPicker({
  value,
  onChange,
}: {
  value: ChipArtist[];
  onChange: (next: ChipArtist[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<ArtistOption[]>([]);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      const out = await searchArtists(q);
      if (!cancelled) setSuggestions(out);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  function add(chip: ChipArtist) {
    // Avoid dupes by name (case-insensitive)
    const exists = value.some(
      (v) => v.name.toLowerCase() === chip.name.toLowerCase(),
    );
    if (!exists) onChange([...value, chip]);
    setQuery("");
    setSuggestions([]);
    setOpen(false);
    inputRef.current?.focus();
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = query.trim();
      if (!trimmed) return;
      // If a suggestion exactly matches what's typed, prefer linking the existing one
      const exact = suggestions.find(
        (s) => s.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (exact) add({ kind: "existing", id: exact.id, name: exact.name });
      else add({ kind: "new", name: trimmed });
    } else if (e.key === "Backspace" && query.length === 0 && value.length > 0) {
      remove(value.length - 1);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 items-center rounded-lg bg-buzz-surface border border-buzz-border px-2 py-1.5 focus-within:ring-2 focus-within:ring-buzz-accent">
        {value.map((c, i) => (
          <span
            key={`${c.name}-${i}`}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              c.kind === "existing"
                ? "bg-buzz-accent text-black"
                : "bg-buzz-card text-buzz-text border border-buzz-border"
            }`}
            title={c.kind === "existing" ? "Linked to existing artist" : "Will be created"}
          >
            {c.name}
            {c.kind === "new" && <span className="opacity-70">(new)</span>}
            <button
              type="button"
              onClick={() => remove(i)}
              className="ml-0.5 hover:opacity-70"
              aria-label={`Remove ${c.name}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKey}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={value.length === 0 ? "Add artist…" : ""}
          className="flex-1 min-w-[120px] bg-transparent outline-none text-sm py-1"
        />
      </div>
      {open && query.trim().length >= 2 && (
        <div className="relative">
          <div className="absolute z-20 mt-1 w-full max-w-md rounded-lg bg-buzz-card border border-buzz-border shadow-lg overflow-hidden">
            {suggestions.length > 0 ? (
              suggestions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => add({ kind: "existing", id: s.id, name: s.name })}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-buzz-surface transition flex items-center justify-between"
                >
                  <span>{s.name}</span>
                  <span className="text-xs text-buzz-mute">existing</span>
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-buzz-mute">
                No matches. Press <kbd className="px-1 py-0.5 rounded bg-buzz-surface border border-buzz-border text-xs">Enter</kbd> to add as a new artist.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
