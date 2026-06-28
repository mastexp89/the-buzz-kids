"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  findVenueEnrichments,
  processNominatimBatch,
  applyVenueEnrichments,
  type EnrichableField,
  type EnrichmentSuggestion,
  type PendingNominatimVenue,
} from "./actions";

type City = { slug: string; name: string; active: boolean };
type Festival = {
  id: string;
  name: string;
  slug: string;
  startDate: string;
  endDate: string;
  published: boolean;
};

const ALL_FIELDS: EnrichableField[] = [
  "address",
  "postcode",
  "latitude",
  "longitude",
  "website",
  "phone",
];

const FIELD_LABELS: Record<EnrichableField, string> = {
  address: "Address",
  postcode: "Postcode",
  latitude: "Latitude",
  longitude: "Longitude",
  website: "Website",
  phone: "Phone",
};

export default function VenuesEnrichClient({
  cities,
  festivals,
}: {
  cities: City[];
  festivals: Festival[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Scope is "city:<slug>" or "festival:<id>"
  const defaultScope = cities[0] ? `city:${cities[0].slug}` : "";
  const [scope, setScope] = useState<string>(defaultScope);
  const [phase, setPhase] = useState<"idle" | "scanning" | "reviewing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [scanSummary, setScanSummary] = useState<{
    cityName: string;
    total: number;
    matched: number;
    matchedViaOverpass: number;
    matchedViaNominatim: number;
    missingInOsm: number;
    nominatimSkipped: number;
  } | null>(null);
  const [suggestions, setSuggestions] = useState<EnrichmentSuggestion[]>([]);
  // For each venueId, set of selected EnrichableField — what to write on save.
  const [picked, setPicked] = useState<Record<string, Set<EnrichableField>>>({});
  const [savedInfo, setSavedInfo] = useState<string | null>(null);

  // Elapsed-time tracking for the scan. The server action is a long-running
  // single call (Overpass + Nominatim queries can take 30s–3min depending on
  // venue count and OSM response time), and the button alone gave no signal
  // whether it was still working or had silently died. The timer + status
  // hints below give the admin something to look at while it runs.
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  // Phase 2 progress (Nominatim batches). nominatimTotal stays at 0 until
  // Phase 1 returns; once it does, the client loops batches and ticks
  // nominatimDone up by batch size each round.
  const [nominatimDone, setNominatimDone] = useState(0);
  const [nominatimTotal, setNominatimTotal] = useState(0);

  useEffect(() => {
    if (phase !== "scanning" || scanStartedAt === null) return;
    const id = setInterval(() => {
      setElapsedMs(Date.now() - scanStartedAt);
    }, 250);
    return () => clearInterval(id);
  }, [phase, scanStartedAt]);

  function scan() {
    setError(null);
    setPhase("scanning");
    setSuggestions([]);
    setPicked({});
    setScanSummary(null);
    setSavedInfo(null);
    setScanStartedAt(Date.now());
    setElapsedMs(0);
    setNominatimDone(0);
    setNominatimTotal(0);
    startTransition(async () => {
      // Phase 1: Overpass + matching. Returns initial suggestions plus
      // the list of venues that need Nominatim lookups.
      const [kind, value] = scope.split(":");
      const res =
        kind === "festival"
          ? await findVenueEnrichments({ festivalId: value })
          : await findVenueEnrichments({ citySlug: value });
      if ("error" in res) {
        setError(res.error);
        setPhase("idle");
        return;
      }

      // Seed UI with Overpass matches so the user sees results
      // accumulating instead of staring at "Scanning…" the whole time.
      setSuggestions(res.suggestions);
      setNominatimTotal(res.pendingNominatim.length);

      let nominatimMatchedRunning = 0;
      let missingRunning = 0;
      let allSuggestions: EnrichmentSuggestion[] = [...res.suggestions];

      // Phase 2: process pending Nominatim lookups in batches. Each
      // batch is ~10s server-side (5 venues × 2s each w/ rate-limit),
      // safely under any Vercel function ceiling, so this scales to
      // arbitrarily large regions.
      const BATCH_SIZE = 5;
      const pending = res.pendingNominatim;
      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        const batch = pending.slice(i, i + BATCH_SIZE);
        const batchRes = await processNominatimBatch(batch);
        if ("error" in batchRes) {
          // Don't fail the whole scan — keep what we've got and
          // surface the error inline. User can still review existing
          // suggestions and re-scan to retry the rest.
          setError(`Nominatim batch failed: ${batchRes.error}. Showing partial results.`);
          break;
        }
        nominatimMatchedRunning += batchRes.newSuggestions.length;
        missingRunning += batchRes.missedCount;
        allSuggestions = [...allSuggestions, ...batchRes.newSuggestions];
        setSuggestions(allSuggestions);
        setNominatimDone(Math.min(i + batch.length, pending.length));
      }

      setScanSummary({
        cityName: res.cityName,
        total: res.total,
        matched: res.matched + nominatimMatchedRunning,
        matchedViaOverpass: res.matchedViaOverpass,
        matchedViaNominatim: nominatimMatchedRunning,
        missingInOsm: missingRunning,
        nominatimSkipped: 0,
      });
      // Pre-tick every fillable field so the common case is "scan, save".
      const next: Record<string, Set<EnrichableField>> = {};
      for (const s of allSuggestions) {
        next[s.venueId] = new Set(s.fillable);
      }
      setPicked(next);
      setPhase("reviewing");
    });
  }

  function togglePick(venueId: string, field: EnrichableField) {
    setPicked((p) => {
      const set = new Set(p[venueId] ?? []);
      if (set.has(field)) set.delete(field);
      else set.add(field);
      return { ...p, [venueId]: set };
    });
  }

  function tickAll(venueId: string, suggestion: EnrichmentSuggestion) {
    setPicked((p) => ({ ...p, [venueId]: new Set(suggestion.fillable) }));
  }
  function untickAll(venueId: string) {
    setPicked((p) => ({ ...p, [venueId]: new Set() }));
  }

  const totalChecked = useMemo(() => {
    let n = 0;
    for (const s of Object.values(picked)) n += s.size;
    return n;
  }, [picked]);

  function save() {
    const updates = suggestions
      .map((s) => {
        const fields = picked[s.venueId] ?? new Set();
        if (fields.size === 0) return null;
        const payload: Record<string, any> = {};
        for (const f of fields) {
          payload[f] = s.suggested[f];
        }
        return { venueId: s.venueId, fields: payload };
      })
      .filter((x): x is { venueId: string; fields: Record<string, any> } => x !== null);

    if (updates.length === 0) {
      setError("Tick at least one field to apply.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await applyVenueEnrichments(updates);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setSavedInfo(
        `✓ Saved · updated ${res.updated} venue${res.updated === 1 ? "" : "s"}, ` +
          `wrote ${res.fieldsWritten} field${res.fieldsWritten === 1 ? "" : "s"}.`,
      );
      router.refresh();
      // Re-scan so the rows that just got filled drop off the list.
      scan();
    });
  }

  return (
    <div>
      <div className="card p-5 mb-6 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <label className="label">Scope</label>
          <select
            className="input"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            disabled={phase === "scanning"}
          >
            <optgroup label="By city">
              {cities.map((c) => (
                <option key={c.slug} value={`city:${c.slug}`}>
                  {c.name}
                  {c.active ? "" : " — hidden"}
                </option>
              ))}
            </optgroup>
            {festivals.length > 0 && (
              <optgroup label="By festival">
                {festivals.map((f) => (
                  <option key={f.id} value={`festival:${f.id}`}>
                    🎵 {f.name} ({f.startDate})
                    {f.published ? "" : " — draft"}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <button
          type="button"
          onClick={scan}
          disabled={phase === "scanning"}
          className="btn-primary"
        >
          {phase === "scanning" ? "Scanning OSM…" : "🔍 Scan OSM"}
        </button>
      </div>

      {error && (
        <div className="card p-3 mb-4 text-sm text-rose-400 border-rose-500/40">
          {error}
        </div>
      )}
      {savedInfo && (
        <div className="card p-3 mb-4 text-sm text-emerald-400 border-emerald-500/40">
          {savedInfo}
        </div>
      )}

      {phase === "scanning" && (
        <ScanInFlightCard
          elapsedMs={elapsedMs}
          nominatimDone={nominatimDone}
          nominatimTotal={nominatimTotal}
        />
      )}

      {phase === "reviewing" && scanSummary && (
        <div className="card p-4 mb-4 text-sm">
          <strong>{scanSummary.cityName}</strong>: scanned{" "}
          <strong>{scanSummary.total}</strong> venue
          {scanSummary.total === 1 ? "" : "s"} · matched{" "}
          <strong className="text-emerald-400">{scanSummary.matched}</strong> in
          OSM
          <span className="text-buzz-mute">
            {" "}
            (Overpass {scanSummary.matchedViaOverpass} · Nominatim{" "}
            {scanSummary.matchedViaNominatim})
          </span>
          {scanSummary.missingInOsm > 0 && (
            <>
              {" · "}
              <strong className="text-rose-400">
                {scanSummary.missingInOsm}
              </strong>{" "}
              not found in OSM (would need manual entry)
            </>
          )}
          {scanSummary.nominatimSkipped > 0 && (
            <div className="text-xs text-buzz-mute mt-1">
              ⚠️ {scanSummary.nominatimSkipped} venue
              {scanSummary.nominatimSkipped === 1 ? "" : "s"} skipped because
              the Nominatim fallback hit its per-scan budget (30 lookups). Save
              what you have, then re-scan to pick up the rest.
            </div>
          )}
        </div>
      )}

      {phase === "reviewing" && suggestions.length === 0 && (
        <div className="card p-8 text-center text-buzz-mute">
          ✨ Nothing to enrich — every matched venue already has all fields
          OSM could fill.
        </div>
      )}

      {phase === "reviewing" && suggestions.length > 0 && (
        <div>
          <div className="sticky top-0 bg-buzz-bg/95 backdrop-blur z-10 -mx-2 px-2 py-3 mb-3 border-b border-buzz-border">
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <p className="text-sm">
                <strong>{suggestions.length}</strong> venue
                {suggestions.length === 1 ? "" : "s"} have fillable blanks ·{" "}
                <strong className="text-buzz-accent">{totalChecked}</strong> field
                {totalChecked === 1 ? "" : "s"} ticked
              </p>
              <button
                type="button"
                onClick={save}
                disabled={totalChecked === 0}
                className="btn-primary"
              >
                💾 Apply {totalChecked} change{totalChecked === 1 ? "" : "s"}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {suggestions.map((s) => {
              const set = picked[s.venueId] ?? new Set<EnrichableField>();
              return (
                <div key={s.venueId} className="card p-4">
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <div>
                      <div className="font-medium">
                        {s.venueName}
                        {s.citySlug && (
                          <Link
                            href={`/${s.citySlug}/venues/${s.venueSlug}`}
                            target="_blank"
                            className="ml-2 text-xs text-buzz-mute hover:text-buzz-accent"
                          >
                            View ↗
                          </Link>
                        )}
                      </div>
                      <div className="text-xs text-buzz-mute">
                        {s.fillable.length} blank field
                        {s.fillable.length === 1 ? "" : "s"} · matched via{" "}
                        {s.matchSource}
                      </div>
                    </div>
                    <div className="flex gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => tickAll(s.venueId, s)}
                        className="text-buzz-accent hover:underline"
                      >
                        Tick all
                      </button>
                      <span className="text-buzz-mute">·</span>
                      <button
                        type="button"
                        onClick={() => untickAll(s.venueId)}
                        className="text-buzz-mute hover:underline"
                      >
                        Untick all
                      </button>
                    </div>
                  </div>

                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-buzz-mute">
                        <th className="py-1 pr-2 w-8"></th>
                        <th className="py-1 pr-3">Field</th>
                        <th className="py-1 pr-3">Current</th>
                        <th className="py-1 pr-3">OSM suggests</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ALL_FIELDS.map((f) => {
                        const isFillable = s.fillable.includes(f);
                        const isChecked = set.has(f);
                        return (
                          <tr key={f} className="border-t border-buzz-border/40">
                            <td className="py-1.5 pr-2">
                              {isFillable ? (
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => togglePick(s.venueId, f)}
                                  className="w-4 h-4 cursor-pointer accent-buzz-accent"
                                  aria-label={`Fill ${FIELD_LABELS[f]}`}
                                />
                              ) : (
                                <span className="text-buzz-mute text-xs">—</span>
                              )}
                            </td>
                            <td className="py-1.5 pr-3 text-buzz-mute text-xs">
                              {FIELD_LABELS[f]}
                            </td>
                            <td className="py-1.5 pr-3">
                              {formatCell(s.current[f])}
                            </td>
                            <td
                              className={
                                "py-1.5 pr-3 " +
                                (isFillable ? "text-emerald-400" : "text-buzz-mute")
                              }
                            >
                              {formatCell(s.suggested[f])}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function formatCell(v: string | number | null): React.ReactNode {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) {
    return <span className="text-buzz-mute text-xs italic">—</span>;
  }
  if (typeof v === "number") {
    return <span className="font-mono text-xs">{v.toFixed(5)}</span>;
  }
  return <span className="text-xs">{v}</span>;
}

// Live progress panel for the in-flight OSM scan. Two distinct stages:
//   • Pre-Phase-2: showing elapsed time while Overpass + matching runs
//     (no per-venue progress to report — single bulk call)
//   • Phase 2: showing "X of Y venues processed" as Nominatim batches
//     complete on the server and the client polls more
//
// The progress bar only appears once the server has returned the pending
// list — until then there's no total to tick against.
function ScanInFlightCard({
  elapsedMs,
  nominatimDone,
  nominatimTotal,
}: {
  elapsedMs: number;
  nominatimDone: number;
  nominatimTotal: number;
}) {
  const sec = Math.floor(elapsedMs / 1000);
  const elapsedLabel = sec < 60
    ? `${sec}s`
    : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

  // Two-stage UX: first while Overpass+matching runs (no progress total),
  // then while batches of Nominatim lookups complete (concrete fraction).
  const inPhase2 = nominatimTotal > 0;
  const phase2Pct = inPhase2
    ? Math.min(100, Math.round((nominatimDone / nominatimTotal) * 100))
    : 0;

  let status = "Querying Overpass for venues in the region…";
  if (inPhase2) {
    if (nominatimDone === 0) {
      status = `Overpass done — looking up ${nominatimTotal} unmatched venue${nominatimTotal === 1 ? "" : "s"} via Nominatim. ~2s per venue.`;
    } else if (nominatimDone < nominatimTotal) {
      status = `Looking up venues that Overpass missed — Nominatim rate limit is 1 req/sec so this is the slow bit.`;
    } else {
      status = "Wrapping up…";
    }
  } else if (sec >= 25 && sec < 50) {
    status = "Overpass is being slow today — bigger regions can take 30-60s. Hang tight.";
  } else if (sec >= 50) {
    status = "Still waiting on Overpass. Will time out at 70s and surface an error if it doesn't return.";
  }

  return (
    <div className="card mb-4 p-4 flex items-start gap-3 border-buzz-border">
      <div className="shrink-0 mt-0.5">
        <div className="relative w-5 h-5">
          <div className="absolute inset-0 rounded-full border-2 border-buzz-accent/30" />
          <div className="absolute inset-0 rounded-full border-2 border-buzz-accent border-t-transparent animate-spin" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
          <span className="font-medium text-sm">Scanning OpenStreetMap</span>
          {inPhase2 ? (
            <span className="text-xs text-buzz-mute tabular-nums">
              · <strong className="text-buzz-accent">{nominatimDone}</strong> / {nominatimTotal} venues processed
            </span>
          ) : (
            <span className="text-xs text-buzz-mute tabular-nums">· elapsed {elapsedLabel}</span>
          )}
        </div>
        <p className="text-xs text-buzz-mute leading-snug">{status}</p>
        {inPhase2 && (
          <div className="mt-2 h-1 rounded-full bg-buzz-border overflow-hidden">
            <div
              className="h-full bg-buzz-accent transition-all duration-300"
              style={{ width: `${phase2Pct}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
