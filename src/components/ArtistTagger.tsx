"use client";

import { useState, useRef, useEffect } from "react";

export type ArtistTag =
  | { kind: "existing"; id: string; name: string }
  | { kind: "new"; name: string };

type SearchResult = { id: string; name: string; slug: string; image_url: string | null };

export default function ArtistTagger({
  initial,
  onChange,
}: {
  initial: ArtistTag[];
  onChange: (tags: ArtistTag[]) => void;
}) {
  const [tags, setTags] = useState<ArtistTag[]>(initial);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onChange(tags);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tags]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/artists/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data.artists ?? []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function addTag(tag: ArtistTag) {
    // Avoid dupes
    if (tag.kind === "existing" && tags.some((t) => t.kind === "existing" && t.id === tag.id)) return;
    if (
      tag.kind === "new" &&
      tags.some((t) => t.name.toLowerCase().trim() === tag.name.toLowerCase().trim())
    ) return;
    setTags((prev) => [...prev, tag]);
    setQuery("");
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  }

  function removeTag(idx: number) {
    setTags((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (query.trim()) {
        // Prefer exact match from results
        const exact = results.find((r) => r.name.toLowerCase().trim() === query.toLowerCase().trim());
        if (exact) addTag({ kind: "existing", id: exact.id, name: exact.name });
        else addTag({ kind: "new", name: query.trim() });
      }
    } else if (e.key === "Backspace" && !query && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  }

  const exactMatch = results.find(
    (r) => r.name.toLowerCase().trim() === query.toLowerCase().trim()
  );

  return (
    <div className="relative">
      {/* Pills + input */}
      <div className="input flex flex-wrap gap-1.5 items-center min-h-[44px] cursor-text" onClick={() => inputRef.current?.focus()}>
        {tags.map((t, i) => (
          <span
            key={i}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs ${
              t.kind === "existing"
                ? "bg-buzz-accent text-black font-semibold"
                : "bg-buzz-surface border border-dashed border-buzz-accent text-buzz-text"
            }`}
            title={t.kind === "new" ? "New artist — will be created on save" : "Existing artist"}
          >
            {t.kind === "new" && <span className="opacity-60">＋</span>}
            {t.name}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTag(i); }}
              className="ml-0.5 hover:opacity-60"
              aria-label={`Remove ${t.name}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          placeholder={tags.length === 0 ? "Type artist names…" : ""}
          className="flex-1 bg-transparent outline-none text-sm min-w-[120px]"
        />
      </div>

      {/* Dropdown */}
      {open && query.trim() && (
        <div
          className="absolute z-30 left-0 right-0 mt-1 card border border-buzz-border rounded-lg shadow-2xl max-h-64 overflow-y-auto"
          onMouseDown={(e) => e.preventDefault()}
        >
          {loading && <div className="px-3 py-2 text-xs text-buzz-mute">Searching…</div>}

          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => addTag({ kind: "existing", id: r.id, name: r.name })}
              className="w-full text-left px-3 py-2 hover:bg-buzz-surface flex items-center gap-2 text-sm border-b border-buzz-border/50 last:border-b-0"
            >
              {r.image_url ? (
                <span
                  className="w-7 h-7 rounded-full bg-buzz-surface shrink-0"
                  style={{ backgroundImage: `url(${r.image_url})`, backgroundSize: "cover", backgroundPosition: "center" }}
                />
              ) : (
                <span className="w-7 h-7 rounded-full bg-buzz-accent/20 grid place-items-center shrink-0 text-xs">🎵</span>
              )}
              <span className="font-medium">{r.name}</span>
              <span className="ml-auto text-[10px] text-buzz-mute">existing</span>
            </button>
          ))}

          {!exactMatch && query.trim() && !loading && (
            <button
              type="button"
              onClick={() => addTag({ kind: "new", name: query.trim() })}
              className="w-full text-left px-3 py-2 hover:bg-buzz-surface flex items-center gap-2 text-sm border-t border-buzz-border bg-buzz-bg/50"
            >
              <span className="w-7 h-7 rounded-full bg-buzz-accent grid place-items-center shrink-0 text-black font-bold">＋</span>
              <span>
                Create <span className="font-semibold text-buzz-accent">"{query.trim()}"</span> as a new artist
              </span>
            </button>
          )}

          {!loading && results.length === 0 && exactMatch === undefined && query.length < 1 && (
            <div className="px-3 py-2 text-xs text-buzz-mute">Start typing to find or create an artist…</div>
          )}
        </div>
      )}
    </div>
  );
}
