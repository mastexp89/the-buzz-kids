"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  searchUnclaimedVenues,
  claimVenue,
  createNewVenueForMe,
  type UnclaimedVenueOption,
} from "./actions";

type CityOption = { slug: string; name: string };

export default function VenueSetupClient({
  suggestedName,
  cities,
}: {
  suggestedName: string;
  cities: CityOption[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState(suggestedName);
  const [results, setResults] = useState<UnclaimedVenueOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [createBusy, setCreateBusy] = useState(false);
  const [createConflicts, setCreateConflicts] = useState<UnclaimedVenueOption[] | null>(null);
  const [city, setCity] = useState<string>(
    cities.find((c) => c.slug === "dundee")?.slug ?? cities[0]?.slug ?? "",
  );

  // Search-as-you-type (debounced)
  useEffect(() => {
    let cancelled = false;
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await searchUnclaimedVenues(query);
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

  async function handleClaim(venueId: string) {
    setBusyId(venueId);
    setError(null);
    const r = await claimVenue(venueId);
    setBusyId(null);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    router.push(`/dashboard/venues/${r.venueId}`);
  }

  async function handleCreate(force = false) {
    setCreateBusy(true);
    setError(null);
    setCreateConflicts(null);
    const r = await createNewVenueForMe({ name: query, citySlug: city, forceCreate: force });
    setCreateBusy(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    if ("conflicts" in r) {
      setCreateConflicts(r.conflicts);
      return;
    }
    router.push(`/dashboard/venues/${r.venueId}/edit`);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Search */}
      <div className="card p-5">
        <label className="label">Your venue name</label>
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Start typing…"
          autoFocus
        />
        <p className="help">
          We'll check the directory for an existing page so you can claim it. Same name in
          different towns? You'll see them all and can pick the right one.
        </p>
      </div>

      {/* Existing matches */}
      {query.trim().length >= 2 && (
        <div className="flex flex-col gap-3">
          {searching && <div className="text-xs text-buzz-mute">Searching…</div>}
          {!searching && results && results.length > 0 && (
            <>
              <div>
                <p className="eyebrow text-buzz-accent text-[10px]">Existing pages</p>
                <h2 className="h-display text-xl">Is one of these yours?</h2>
                <p className="text-xs text-buzz-mute mt-1">
                  Click <strong>This is mine</strong> to claim a page. Your existing event
                  history transfers automatically.
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
                      🐝
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-display text-base uppercase truncate">{r.name}</div>
                    <div className="text-xs text-buzz-mute truncate">
                      {r.town && <strong className="text-buzz-fg">{r.town}</strong>}
                      {r.town && r.cityName && r.town.toLowerCase() !== r.cityName.toLowerCase() && (
                        <> · {r.cityName}</>
                      )}
                      {!r.town && r.cityName && r.cityName}
                      {r.address && <> · {r.address}</>}
                    </div>
                  </div>
                  {r.approved && r.citySlug && (
                    <a
                      href={`/${r.citySlug}/venues/${r.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-buzz-mute hover:text-buzz-accent"
                    >
                      Preview ↗
                    </a>
                  )}
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
        <h2 className="h-display text-xl mb-2">None of these are mine</h2>
        <p className="text-xs text-buzz-mute mb-4">
          We'll create a fresh page for "<strong>{query.trim() || "..."}</strong>". You can fill in
          address, photos, opening hours, socials etc on the next screen. Your page won't be public
          until an admin approves it (we usually review within 24 hours).
        </p>
        {cities.length > 1 && (
          <div className="mb-4">
            <label className="label">City</label>
            <select className="input" value={city} onChange={(e) => setCity(e.target.value)}>
              {cities.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {createConflicts && createConflicts.length > 0 ? (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-4 mb-4 text-sm">
            <div className="font-bold text-rose-300 mb-2">
              ⚠️ We found {createConflicts.length} similar existing page
              {createConflicts.length === 1 ? "" : "s"}
            </div>
            <p className="text-xs text-buzz-mute mb-3">
              Are you sure none of these are you? Claiming an existing page is usually better
              than creating a duplicate.
            </p>
            <ul className="text-xs space-y-1 mb-3">
              {createConflicts.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span>
                    • <strong>{c.name}</strong>
                    {c.town && <span className="text-buzz-mute"> — {c.town}</span>}
                  </span>
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
            disabled={createBusy || query.trim().length < 2 || !city}
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
