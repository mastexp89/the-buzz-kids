"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  searchUnclaimedOrganisers,
  claimOrganiser,
  createNewOrganiserForMe,
  type UnclaimedOrganiserOption,
} from "./actions";

export default function OrganiserSetupClient({ suggestedName }: { suggestedName: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(suggestedName);
  const [results, setResults] = useState<UnclaimedOrganiserOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [createBusy, setCreateBusy] = useState(false);
  const [createConflicts, setCreateConflicts] = useState<UnclaimedOrganiserOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await searchUnclaimedOrganisers(query);
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

  async function handleClaim(id: string) {
    setBusyId(id);
    setError(null);
    const r = await claimOrganiser(id);
    setBusyId(null);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    router.push(`/dashboard/organiser/${r.id}/edit`);
  }

  async function handleCreate(force = false) {
    setCreateBusy(true);
    setError(null);
    setCreateConflicts(null);
    const r = await createNewOrganiserForMe({ name: query, forceCreate: force });
    setCreateBusy(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    if ("conflicts" in r) {
      setCreateConflicts(r.conflicts);
      return;
    }
    router.push(`/dashboard/organiser/${r.id}/edit`);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="card p-5">
        <label className="label">Your promoter / organiser name</label>
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Icebreaker Comedy"
          autoFocus
        />
        <p className="help">
          We'll check the directory for an existing page so you can claim it.
        </p>
      </div>

      {query.trim().length >= 2 && (
        <div className="flex flex-col gap-3">
          {searching && <div className="text-xs text-buzz-mute">Searching…</div>}
          {!searching && results && results.length > 0 && (
            <>
              <div>
                <p className="eyebrow text-buzz-accent text-[10px]">Existing pages</p>
                <h2 className="h-display text-xl">Is one of these yours?</h2>
                <p className="text-xs text-buzz-mute mt-1">
                  Click <strong>This is mine</strong> to claim a page. Existing
                  event links transfer automatically.
                </p>
              </div>
              {results.map((r) => (
                <div key={r.id} className="card p-4 flex items-center gap-3">
                  {r.imageUrl ? (
                    <div
                      className="w-14 h-14 rounded bg-buzz-surface shrink-0 border border-buzz-border"
                      style={{
                        backgroundImage: `url(${r.imageUrl})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }}
                    />
                  ) : (
                    <div className="w-14 h-14 rounded bg-buzz-surface shrink-0 border border-buzz-border grid place-items-center text-2xl">
                      📋
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-display text-base uppercase truncate">{r.name}</div>
                    {r.bio && (
                      <p className="text-xs text-buzz-mute line-clamp-2">{r.bio}</p>
                    )}
                  </div>
                  <a
                    href={`/organisers/${r.slug}`}
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

      <div className="card p-5 border-buzz-accent/40">
        <p className="eyebrow text-buzz-accent text-[10px]">Or create new</p>
        <h2 className="h-display text-xl mb-2">None of these are mine</h2>
        <p className="text-xs text-buzz-mute mb-4">
          We'll create a fresh page for "<strong>{query.trim() || "..."}</strong>". You'll
          fill in bio, photo and socials on the next screen. Your page won't be public
          until an admin approves it (we usually review within 24 hours).
        </p>
        {createConflicts && createConflicts.length > 0 ? (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-4 mb-4 text-sm">
            <div className="font-bold text-rose-300 mb-2">
              ⚠️ We found {createConflicts.length} similar existing page
              {createConflicts.length === 1 ? "" : "s"}
            </div>
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
