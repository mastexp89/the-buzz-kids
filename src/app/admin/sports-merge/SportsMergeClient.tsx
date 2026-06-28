"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  mergeCluster,
  mergeAllClusters,
  type SportsClusterPreview,
} from "./actions";

function fmtDay(dayKey: string): string {
  const d = new Date(`${dayKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
    hour12: false,
  });
}

export default function SportsMergeClient({
  initialClusters,
  totalEventsAcrossClusters,
}: {
  initialClusters: SportsClusterPreview[];
  totalEventsAcrossClusters: number;
}) {
  const router = useRouter();
  const [clusters, setClusters] = useState(initialClusters);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [bulkRunning, startBulk] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function clusterKey(c: SportsClusterPreview) {
    return `${c.venueId}|${c.dayKey}`;
  }

  function mergeOne(c: SportsClusterPreview) {
    setError(null);
    setInfo(null);
    const key = clusterKey(c);
    if (busyKey === key) return;
    setBusyKey(key);
    (async () => {
      const res = await mergeCluster(c.venueId, c.dayKey);
      if ("error" in res) {
        setError(`${c.venueName} ${c.dayKey}: ${res.error}`);
        setBusyKey(null);
        return;
      }
      setClusters((cs) => cs.filter((x) => clusterKey(x) !== key));
      setInfo(`✓ Merged ${res.merged} events at ${c.venueName} (${fmtDay(c.dayKey)}).`);
      setBusyKey(null);
    })();
  }

  function runBulk() {
    if (clusters.length === 0) return;
    if (!confirm(
      `Merge ${clusters.length} clusters (${totalEventsAcrossClusters} events total) into ${clusters.length} consolidated events? This cannot be undone.`,
    )) return;
    setError(null);
    setInfo(null);
    startBulk(async () => {
      const res = await mergeAllClusters();
      const errCount = res.errors.length;
      setInfo(
        `✓ Done. Merged ${res.clustersMerged} clusters, consolidated ${res.eventsConsumed} events.${errCount > 0 ? ` (${errCount} errors — see below.)` : ""}`,
      );
      if (errCount > 0) setError(res.errors.join("\n"));
      router.refresh();
    });
  }

  if (clusters.length === 0 && !info) {
    return (
      <div className="card p-10 text-center text-buzz-mute">
        ✨ Nothing to merge — all sports events already have one row per day per venue.
      </div>
    );
  }

  return (
    <>
      <div className="card p-4 mb-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">
            {clusters.length} {clusters.length === 1 ? "cluster" : "clusters"} to merge
          </div>
          <div className="text-xs text-buzz-mute">
            {totalEventsAcrossClusters} sports event rows will become {clusters.length}.
            Each cluster: one venue, one calendar day, 2+ AI-imported sports events.
          </div>
        </div>
        <button
          type="button"
          onClick={runBulk}
          disabled={bulkRunning || clusters.length === 0}
          className="btn-primary"
        >
          {bulkRunning ? "Merging all…" : `Merge all ${clusters.length}`}
        </button>
      </div>

      {info && (
        <div className="card p-3 mb-3 text-sm text-emerald-400">{info}</div>
      )}
      {error && (
        <pre className="card p-3 mb-3 text-xs text-rose-400 whitespace-pre-wrap">{error}</pre>
      )}

      {clusters.length > 0 && (
        <ul className="card divide-y divide-buzz-border/60">
          {clusters.map((c) => {
            const key = clusterKey(c);
            const busy = busyKey === key;
            return (
              <li key={key} className="p-4 flex flex-col gap-2">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {c.venueName}
                      <span className="text-buzz-mute font-normal"> · {fmtDay(c.dayKey)}</span>
                    </div>
                    <div className="text-xs text-buzz-mute">
                      {c.count} events → 1 consolidated
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => mergeOne(c)}
                    disabled={busy || bulkRunning}
                    className="btn-secondary text-xs px-3 py-1.5 shrink-0"
                  >
                    {busy ? "Merging…" : "Merge"}
                  </button>
                </div>
                <details className="text-xs text-buzz-mute">
                  <summary className="cursor-pointer hover:text-buzz-fg">
                    View {c.count} matches
                  </summary>
                  <ul className="mt-2 space-y-1 pl-2 border-l border-buzz-border/60">
                    {c.events.map((e) => (
                      <li key={e.id}>
                        <span className="text-buzz-fg/80">{fmtTime(e.startIso)}</span>
                        {" — "}
                        <span>{e.title}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
