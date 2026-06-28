"use client";

import { useMemo, useState, useTransition } from "react";
import {
  discoverVenuesForCity,
  bulkAddDiscoveredVenues,
  topUpVenuesViaApify,
  type DiscoveredVenue,
} from "./actions";

type City = { slug: string; name: string; active: boolean; nearbyAreas: string[] };

type Phase = "idle" | "discovering" | "reviewing" | "adding" | "done";

export default function DiscoverVenuesClient({ cities }: { cities: City[] }) {
  // Default to Angus if it exists (the new city we're populating); else first.
  const initialCity =
    cities.find((c) => c.slug === "angus") ?? cities[0] ?? null;

  const [citySlug, setCitySlug] = useState(initialCity?.slug ?? "");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Selected towns to query in the next discover run. Default to the first
  // 4 to stay under the serverless timeout — admin can tick more / fewer.
  const selectedCity = cities.find((c) => c.slug === citySlug);
  const [selectedTowns, setSelectedTowns] = useState<Set<string>>(
    () => new Set((selectedCity?.nearbyAreas ?? []).slice(0, 4)),
  );

  function toggleTown(t: string) {
    setSelectedTowns((s) => {
      const next = new Set(s);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }
  function selectAllTowns() {
    setSelectedTowns(new Set(selectedCity?.nearbyAreas ?? []));
  }
  function selectNoTowns() {
    setSelectedTowns(new Set());
  }

  const [candidates, setCandidates] = useState<DiscoveredVenue[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [discoveryMeta, setDiscoveryMeta] = useState<{
    cityName: string;
    towns: string[];
    cost: number;
    filteredOutOfScope: number;
  } | null>(null);

  const [addedCount, setAddedCount] = useState<number>(0);
  const [skippedCount, setSkippedCount] = useState<number>(0);

  // Per-town Apify top-up — track which towns are mid-request and which
  // have already been topped up (so we hide the button after).
  const [topUpBusy, setTopUpBusy] = useState<Set<string>>(new Set());
  const [toppedUp, setToppedUp] = useState<Set<string>>(new Set());
  const [topUpInfo, setTopUpInfo] = useState<Record<string, string>>({});

  function topUpTown(town: string) {
    if (topUpBusy.has(town) || toppedUp.has(town)) return;
    if (!confirm(
      `Top up ${town} via Google Maps (Apify)?\n\n` +
        `Costs ~$0.002 per result, capped at 40 results — so ~$0.08 worst case.` +
        `\n\nIf the run hangs, we'll abort it after 45 seconds to stop the bill.`,
    )) return;

    setTopUpBusy((s) => new Set(s).add(town));
    startTransition(async () => {
      const res = await topUpVenuesViaApify(citySlug, town);
      setTopUpBusy((s) => {
        const next = new Set(s);
        next.delete(town);
        return next;
      });
      if ("error" in res) {
        setTopUpInfo((m) => ({ ...m, [town]: `Error: ${res.error}` }));
        return;
      }
      // Merge new candidates into the list, deduping by name.
      const existingKeys = new Set(candidates.map((c) => key(c)));
      const fresh = res.candidates.filter((c) => !existingKeys.has(key(c)));
      setCandidates((cs) => [...cs, ...fresh]);
      // Pre-tick the genuinely new ones (not in DB).
      setPicked((s) => {
        const next = new Set(s);
        for (const c of fresh) {
          if (!c.alreadyExists) next.add(key(c));
        }
        return next;
      });
      setToppedUp((s) => new Set(s).add(town));
      setTopUpInfo((m) => ({
        ...m,
        [town]:
          `+${fresh.length} new from Google Maps` +
          (res.filteredOutOfScope > 0 ? ` · ${res.filteredOutOfScope} dropped (outside ${town})` : "") +
          (res.timedOut ? " · timed out (run aborted)" : "") +
          ` · ≈ $${res.apifyCost.toFixed(2)}`,
      }));
    });
  }

  function key(c: DiscoveredVenue) {
    return c.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function toggle(c: DiscoveredVenue) {
    if (c.alreadyExists) return; // can't pick dupes
    const k = key(c);
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function selectAll() {
    setPicked(new Set(candidates.filter((c) => !c.alreadyExists).map(key)));
  }
  function selectNone() {
    setPicked(new Set());
  }

  function runDiscovery() {
    if (!citySlug) return;
    setError(null);
    setPhase("discovering");
    setCandidates([]);
    setPicked(new Set());
    setDiscoveryMeta(null);
    setAddedCount(0);
    setSkippedCount(0);

    startTransition(async () => {
      const res = await discoverVenuesForCity(citySlug, Array.from(selectedTowns));
      if ("error" in res) {
        setError(res.error);
        setPhase("idle");
        return;
      }
      setCandidates(res.candidates);
      setDiscoveryMeta({
        cityName: res.cityName,
        towns: res.towns,
        cost: res.apifyCost,
        filteredOutOfScope: res.filteredOutOfScope,
      });
      // Pre-tick everything that's new (not already in DB) so the default
      // action is "add the lot" and admin only unticks anything dodgy.
      setPicked(new Set(res.candidates.filter((c) => !c.alreadyExists).map(key)));
      setPhase("reviewing");
    });
  }

  function bulkAdd() {
    setError(null);
    setPhase("adding");
    const toAdd = candidates.filter((c) => picked.has(key(c)));
    startTransition(async () => {
      const res = await bulkAddDiscoveredVenues(citySlug, toAdd);
      if ("error" in res) {
        setError(res.error);
        setPhase("reviewing");
        return;
      }
      setAddedCount(res.added);
      setSkippedCount(res.skipped);
      setPhase("done");
    });
  }

  function reset() {
    setPhase("idle");
    setCandidates([]);
    setPicked(new Set());
    setError(null);
    setAddedCount(0);
    setSkippedCount(0);
    setDiscoveryMeta(null);
  }

  // Group visible candidates by town for display.
  const grouped = useMemo(() => {
    const map = new Map<string, DiscoveredVenue[]>();
    for (const c of candidates) {
      const t = c.town || "—";
      const list = map.get(t) ?? [];
      list.push(c);
      map.set(t, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [candidates]);

  const newCount = candidates.filter((c) => !c.alreadyExists).length;
  const dupCount = candidates.length - newCount;

  return (
    <div>
      {/* City picker + town checkboxes + Discover button */}
      <div className="card p-5 mb-6 flex flex-col gap-4">
        <div>
          <label className="label">City</label>
          <select
            className="input"
            value={citySlug}
            onChange={(e) => {
              setCitySlug(e.target.value);
              const next = cities.find((c) => c.slug === e.target.value);
              setSelectedTowns(new Set((next?.nearbyAreas ?? []).slice(0, 4)));
            }}
            disabled={phase === "discovering" || phase === "adding"}
          >
            {cities.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
                {c.nearbyAreas.length > 0 ? ` (${c.nearbyAreas.length} towns)` : ""}
                {c.active ? "" : " — hidden"}
              </option>
            ))}
          </select>
        </div>

        {selectedCity && selectedCity.nearbyAreas.length > 0 && (
          <div>
            <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
              <label className="label mb-0">
                Towns to search ({selectedTowns.size} selected)
              </label>
              <div className="flex gap-2 text-xs">
                <button type="button" onClick={selectAllTowns} className="text-buzz-mute hover:text-buzz-accent">
                  All
                </button>
                <span className="text-buzz-mute">·</span>
                <button type="button" onClick={selectNoTowns} className="text-buzz-mute hover:text-buzz-accent">
                  None
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedCity.nearbyAreas.map((t) => {
                const checked = selectedTowns.has(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTown(t)}
                    disabled={phase === "discovering" || phase === "adding"}
                    className={
                      "px-3 py-1.5 rounded-full text-sm transition border " +
                      (checked
                        ? "bg-buzz-accent text-buzz-bg border-buzz-accent font-medium"
                        : "bg-buzz-card text-buzz-mute border-buzz-border hover:border-buzz-accent")
                    }
                  >
                    {checked ? "✓ " : ""}
                    {t}
                  </button>
                );
              })}
            </div>
            <p className="help mt-2">
              Tip: stick to 3-4 towns per run so Apify finishes inside the
              timeout. You can run again after with the next batch — duplicates
              get flagged automatically.
            </p>
          </div>
        )}

        <div>
          <button
            type="button"
            className="btn-primary"
            onClick={runDiscovery}
            disabled={!citySlug || selectedTowns.size === 0 || phase === "discovering" || phase === "adding"}
          >
            {phase === "discovering"
              ? "Searching Google Maps…"
              : `🗺️ Discover ${selectedTowns.size > 0 ? `(${selectedTowns.size} ${selectedTowns.size === 1 ? "town" : "towns"})` : ""}`}
          </button>
        </div>
      </div>

      {error && (
        <div className="card p-3 mb-6 text-sm text-rose-400 border-rose-500/40">
          {error}
        </div>
      )}

      {phase === "discovering" && (
        <div className="card p-8 text-center text-buzz-mute">
          Searching Google Maps for pubs across each town…
          <br />
          <span className="text-xs">
            This usually takes 20–60 seconds. Don't navigate away.
          </span>
        </div>
      )}

      {(phase === "reviewing" || phase === "adding") && discoveryMeta && (
        <div>
          <div className="card p-4 mb-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <div>
              <strong>{candidates.length}</strong> candidates found across{" "}
              <strong>{discoveryMeta.towns.length}</strong> towns ·{" "}
              <span className="text-emerald-400">{newCount} new</span>
              {dupCount > 0 && (
                <>
                  {" · "}
                  <span className="text-buzz-mute">{dupCount} already in DB</span>
                </>
              )}
              {discoveryMeta.filteredOutOfScope > 0 && (
                <>
                  {" · "}
                  <span className="text-buzz-mute">
                    {discoveryMeta.filteredOutOfScope} dropped (outside {discoveryMeta.cityName})
                  </span>
                </>
              )}
              {" · "}
              <span className="text-emerald-400">Free (OpenStreetMap)</span>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={selectAll} className="btn-ghost text-xs">
                Tick all new
              </button>
              <button type="button" onClick={selectNone} className="btn-ghost text-xs">
                Untick all
              </button>
            </div>
          </div>

          {grouped.map(([town, list]) => (
            <div key={town} className="mb-6">
              <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
                <h3 className="font-display text-lg uppercase">
                  {town}{" "}
                  <span className="text-buzz-mute text-sm font-normal">
                    ({list.filter((c) => !c.alreadyExists).length} new)
                  </span>
                </h3>
                {town !== "—" && (
                  <button
                    type="button"
                    onClick={() => topUpTown(town)}
                    disabled={topUpBusy.has(town) || toppedUp.has(town)}
                    title={
                      toppedUp.has(town)
                        ? "Already topped up via Apify this session"
                        : `Pull up to 40 more from Google Maps for ${town} (~$0.08 worst case)`
                    }
                    className="text-xs btn-ghost shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {topUpBusy.has(town)
                      ? "Searching Google…"
                      : toppedUp.has(town)
                      ? "✓ Topped up"
                      : "🔍 Top up via Google Maps"}
                  </button>
                )}
              </div>
              {topUpInfo[town] && (
                <p className="text-xs text-buzz-mute mb-2">{topUpInfo[town]}</p>
              )}
              <ul className="card divide-y divide-buzz-border/60">
                {list.map((c) => {
                  const k = key(c);
                  const checked = picked.has(k);
                  return (
                    <li
                      key={k}
                      className={
                        "p-3 flex items-start gap-3 " +
                        (c.alreadyExists ? "opacity-50" : "")
                      }
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={c.alreadyExists}
                        onChange={() => toggle(c)}
                        className="mt-1 w-4 h-4 cursor-pointer accent-buzz-accent shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate flex items-center gap-2">
                          {c.name}
                          {c.alreadyExists && (
                            <span className="text-[10px] uppercase text-buzz-mute bg-buzz-card px-1.5 py-0.5 rounded">
                              In DB
                            </span>
                          )}
                          {c.category && (
                            <span className="text-[10px] uppercase text-buzz-mute">
                              · {c.category}
                            </span>
                          )}
                          {c.rating !== null && c.rating !== undefined && (
                            <span className="text-[10px] text-buzz-mute">
                              ⭐ {c.rating.toFixed(1)}
                              {c.reviewCount ? ` (${c.reviewCount})` : ""}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-buzz-mute truncate">
                          {c.address ?? "(no address)"}
                        </div>
                        <div className="text-xs text-buzz-mute flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                          {c.website && (
                            <a
                              href={c.website}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:text-buzz-accent truncate max-w-[200px]"
                            >
                              🌐 {c.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                            </a>
                          )}
                          {c.phone && <span>📞 {c.phone}</span>}
                          {c.googleMapsUrl && (
                            <a
                              href={c.googleMapsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:text-buzz-accent"
                            >
                              📍 Google Maps ↗
                            </a>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          <div className="sticky bottom-4 flex justify-end mt-6">
            <div className="card p-3 flex items-center gap-3 shadow-lg">
              <span className="text-sm">
                <strong>{picked.size}</strong> selected
              </span>
              <button
                type="button"
                onClick={bulkAdd}
                disabled={picked.size === 0 || phase === "adding"}
                className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {phase === "adding" ? "Adding…" : `+ Add ${picked.size} venues`}
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className="card p-8 text-center">
          <h2 className="h-display text-3xl mb-2">Done ✓</h2>
          <p className="text-buzz-mute mb-1">
            Added <strong className="text-emerald-400">{addedCount}</strong> new venues to{" "}
            {discoveryMeta?.cityName ?? citySlug}.
          </p>
          {skippedCount > 0 && (
            <p className="text-buzz-mute text-sm mb-4">
              Skipped {skippedCount} (duplicates or insert errors).
            </p>
          )}
          <p className="text-xs text-buzz-mute mb-6 max-w-md mx-auto">
            Next step: head to <strong>📘 Venue FB URLs</strong> to fill in
            Facebook pages for the new venues, then run the FB scraper to
            pull their events.
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            <button type="button" onClick={reset} className="btn-secondary">
              Discover another city
            </button>
            <a href="/admin/venues-facebook" className="btn-primary">
              📘 Fill FB URLs →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
