"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { searchUsersForCompose, type ComposeUserOption } from "@/lib/messages-actions";

export default function ComposeBox() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ComposeUserOption[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const out = await searchUsersForCompose(q);
      if (!cancelled) {
        setResults(out);
        setSearching(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  function pick(u: ComposeUserOption) {
    router.push(`/admin/messages/${u.id}`);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary"
      >
        ✏️ Compose
      </button>
    );
  }

  return (
    <div className="card p-4 w-full max-w-md">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="eyebrow">Send a message</p>
        <button
          type="button"
          onClick={() => { setOpen(false); setQuery(""); setResults([]); }}
          className="text-xs text-buzz-mute hover:text-buzz-accent"
        >
          Cancel
        </button>
      </div>
      <input
        ref={inputRef}
        className="input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or email…"
      />
      {query.trim().length >= 2 && (
        <div className="mt-2 rounded-lg bg-buzz-surface border border-buzz-border max-h-72 overflow-auto">
          {searching && <div className="p-3 text-sm text-buzz-mute">Searching…</div>}
          {!searching && results.length === 0 && (
            <div className="p-3 text-sm text-buzz-mute">No users matched.</div>
          )}
          {!searching && results.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => pick(u)}
              className="w-full text-left px-3 py-2 hover:bg-buzz-card transition flex items-center gap-2"
            >
              <span className="w-7 h-7 rounded-full bg-buzz-card border border-buzz-border grid place-items-center text-xs">
                {u.role === "artist" ? "🎤" : u.role === "venue_owner" ? "🐝" : "👤"}
              </span>
              <span className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {u.display_name ?? u.email ?? "—"}
                </div>
                <div className="text-xs text-buzz-mute truncate">{u.email} · {u.role}</div>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
