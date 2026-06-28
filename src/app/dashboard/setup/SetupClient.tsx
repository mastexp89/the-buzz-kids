"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  searchUnclaimedArtists,
  claimArtist,
  createNewArtistForMe,
  type UnclaimedArtistOption,
} from "./actions";

export default function SetupClient({ suggestedName }: { suggestedName: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(suggestedName);
  const [results, setResults] = useState<UnclaimedArtistOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // For the create-new path
  const [createBusy, setCreateBusy] = useState(false);
  const [createConflicts, setCreateConflicts] = useState<UnclaimedArtistOption[] | null>(null);

  // Search-as-you-type (debounced)
  useEffect(() => {
    let cancelled = false;
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await searchUnclaimedArtists(query);
      if (!cancelled) {
        setResults(r);
        setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  async function handleClaim(artistId: string) {
    setBusyId(artistId);
    setError(null);
    const r = await claimArtist(artistId);
    setBusyId(null);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    router.push(`/artists/${r.slug}`);
  }

  async function handleCreate(force = false) {
    setCreateBusy(true);
    setError(null);
    setCreateConflicts(null);
    const r = await createNewArtistForMe({ name: query, forceCreate: force });
    setCreateBusy(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    if ("conflicts" in r) {
      setCreateConflicts(r.conflicts);
      return;
    }
    router.push(`/artists/${r.slug}`);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Search */}
      <div className="card p-5">
        <label className="label">Your band / artist / DJ name</label>
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Start typing…"
          autoFocus
        />
        <p className="help">We'll check the directory for an existing page so you can claim it.</p>
      </div>

      {/* Existing matches */}
      {query.trim().length >= 2 && (
        <div className="flex flex-col gap-3">
          {searching && (
            <div className="text-xs text-buzz-mute">Searching…</div>
          )}
          {!searching && results && results.length > 0 && (
            <>
              <div>
                <p className="eyebrow text-buzz-accent text-[10px]">Existing pages</p>
                <h2 className="h-display text-xl">Is one of these you?</h2>
                <p className="text-xs text-buzz-mute mt-1">
                  Click <strong>This is mine</strong> to claim a page. Your existing event history transfers automatically.
                </p>
              </div>
              {results.map((r) => (
                <div key={r.id} className="card p-4 flex items-center gap-3">
                  {r.image_url ? (
                    <div
                      className="w-14 h-14 rounded bg-buzz-surface shrink-0 border border-buzz-border"
                      style={{ backgroundImage: `url(${r.image_url})`, backgroundSize: "cover", backgroundPosition: "center" }}
                    />
                  ) : (
                    <div className="w-14 h-14 rounded bg-buzz-surface shrink-0 border border-buzz-border grid place-items-center text-2xl">🎤</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-display text-base uppercase truncate">{r.name}</div>
                    <div className="text-xs text-buzz-mute">
                      {r.recent_event_count > 0
                        ? `${r.recent_event_count} recent gig${r.recent_event_count === 1 ? "" : "s"} listed`
                        : "No recent gigs"}
                    </div>
                  </div>
                  <a
                    href={`/artists/${r.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-buzz-mute hover:text-buzz-accent"
                  >
                    Preview ↗
                  </a>
                  <button
                    type="button"
                    onClick={() => handleClaim(r.id)}
                    disabled={busyId === r.id || createBusy}
                    className="btn-primary text-xs whitespace-nowrap"
                  >
                    {busyId === r.id ? "Claiming…" : "This is mine"}
                  </button>
                </div>
              ))}
            </>
          )}
          {!searching && results && results.length === 0 && (
            <div className="card p-4 text-sm text-buzz-mute">
              No existing pages match "{query}". You can create a new one below.
            </div>
          )}
        </div>
      )}

      {/* Create new */}
      <div className="card p-5 border-buzz-accent/40">
        <p className="eyebrow text-buzz-accent text-[10px]">Or create new</p>
        <h2 className="h-display text-xl mb-2">None of these are me</h2>
        <p className="text-xs text-buzz-mute mb-4">
          We'll create a fresh page for "<strong>{query.trim() || "..."}</strong>". You can edit
          everything (bio, photo, links) once it's live.
        </p>
        {createConflicts && createConflicts.length > 0 ? (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-4 mb-4 text-sm">
            <div className="font-bold text-rose-300 mb-2">⚠️ We found {createConflicts.length} similar existing page{createConflicts.length === 1 ? "" : "s"}</div>
            <p className="text-xs text-buzz-mute mb-3">
              Are you sure none of these are you? Claiming an existing page is usually better than creating a duplicate.
            </p>
            <ul className="text-xs space-y-1 mb-3">
              {createConflicts.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span>• <strong>{c.name}</strong></span>
                  <button
                    type="button"
                    onClick={() => handleClaim(c.id)}
                    disabled={busyId === c.id}
                    className="text-xs text-buzz-accent hover:underline"
                  >
                    Claim "{c.name}"
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => handleCreate(true)}
              disabled={createBusy}
              className="text-xs text-rose-400 hover:text-rose-300"
            >
              {createBusy ? "Creating…" : "I'm sure — create a new page anyway"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => handleCreate(false)}
            disabled={createBusy || query.trim().length < 2}
            className="btn-secondary"
          >
            {createBusy ? "Creating…" : "Create my new page"}
          </button>
        )}
      </div>

      {error && (
        <div className="card p-3 text-sm text-rose-400 border-rose-500/40">{error}</div>
      )}
    </div>
  );
}
