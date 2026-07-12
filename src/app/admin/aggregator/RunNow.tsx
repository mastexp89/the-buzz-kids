"use client";

import { useState } from "react";
import { runAggregatorNow } from "./actions";
import type { AggregatorRunResult } from "@/lib/aggregator-ingest";

export default function RunNow() {
  const [busy, setBusy] = useState<null | "dry" | "live">(null);
  const [result, setResult] = useState<AggregatorRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(dry: boolean) {
    setBusy(dry ? "dry" : "live");
    setError(null);
    setResult(null);
    try {
      setResult(await runAggregatorNow(dry));
    } catch (e: any) {
      setError(e?.message ?? "Run failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => run(true)} disabled={!!busy} className="btn-secondary text-sm disabled:opacity-50">
          {busy === "dry" ? "Checking…" : "🔍 Dry run (no writes)"}
        </button>
        <button onClick={() => run(false)} disabled={!!busy} className="btn-primary text-sm disabled:opacity-50">
          {busy === "live" ? "Running… (up to ~1 min)" : "▶ Run now (into queue)"}
        </button>
      </div>
      {busy === "live" && (
        <p className="text-xs text-buzz-mute mt-2">
          Reading each listing with AI — this can take up to a minute. Keep this tab open; it does ~12 new
          listings per run, so click again for more (the weekly cron clears the rest automatically).
        </p>
      )}
      {error && <p className="text-sm text-rose-500 mt-2">{error}</p>}
      {result && (
        <p className="text-sm mt-3" style={{ color: "#3B6D11" }}>
          {result.dry ? (
            <>
              Dry run (free) — swept {result.sourcesRun} feed{result.sourcesRun === 1 ? "" : "s"} ·
              {" "}{result.detailUrlsFound} listings, <strong>{result.newUrls} new</strong> ({result.skippedSeen} already seen).
              {" "}Run live to extract them into the queue.
            </>
          ) : (
            <>
              Swept {result.sourcesRun} feed{result.sourcesRun === 1 ? "" : "s"} ·
              {" "}{result.detailUrlsFound} listings ({result.skippedSeen} already seen, {result.newUrls} new) ·
              {" "}processed {result.processed} → <strong>{result.events} event{result.events === 1 ? "" : "s"}</strong>
              {" "}+ <strong>{result.places} place{result.places === 1 ? "" : "s"}</strong> added to the review queue.
            </>
          )}
          {result.warnings.length > 0 && <> · {result.warnings.length} warning{result.warnings.length === 1 ? "" : "s"}</>}
        </p>
      )}
      {result && result.warnings.length > 0 && (
        <details className="mt-2">
          <summary className="text-xs text-buzz-mute cursor-pointer hover:text-buzz-accent">Show warnings</summary>
          <ul className="mt-1 text-[11px] text-buzz-mute space-y-1 list-disc pl-4 break-all">
            {result.warnings.slice(0, 12).map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
