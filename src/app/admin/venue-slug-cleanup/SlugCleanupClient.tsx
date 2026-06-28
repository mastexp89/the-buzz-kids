"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renameVenueSlug, renameAllSafe, type SuffixedVenue } from "./actions";

export default function SlugCleanupClient({
  initialVenues,
}: {
  initialVenues: SuffixedVenue[];
}) {
  const router = useRouter();
  const [venues, setVenues] = useState(initialVenues);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkRunning, startBulk] = useTransition();
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const freeCount = venues.filter((v) => v.status === "free").length;
  const collisionCount = venues.filter((v) => v.status === "collision").length;

  function renameOne(v: SuffixedVenue) {
    setError(null);
    setInfo(null);
    if (busyId) return;
    setBusyId(v.id);
    (async () => {
      const res = await renameVenueSlug(v.id, v.proposedSlug);
      if ("error" in res) {
        setError(`${v.name}: ${res.error}`);
        setBusyId(null);
        return;
      }
      // Drop the row from the visible list — it's clean now.
      setVenues((vs) => vs.filter((x) => x.id !== v.id));
      setInfo(`✓ ${v.name} → /${v.citySlug}/venues/${res.newSlug}`);
      setBusyId(null);
    })();
  }

  function runBulk() {
    if (freeCount === 0) return;
    if (!confirm(
      `Rename ${freeCount} venues whose clean slug is free? ${collisionCount} collisions will be skipped for manual review. This adds a slug_redirect for each so old links still work.`,
    )) return;
    setError(null);
    setInfo(null);
    startBulk(async () => {
      const res = await renameAllSafe();
      setInfo(
        `✓ Done. Renamed ${res.renamed} venues, skipped ${res.skipped} (collisions). ${res.errors.length > 0 ? `${res.errors.length} errors — see below.` : ""}`,
      );
      if (res.errors.length > 0) setError(res.errors.join("\n"));
      router.refresh();
    });
  }

  if (venues.length === 0 && !info) {
    return (
      <div className="card p-10 text-center text-buzz-mute">
        ✨ Nothing to clean up — no venues have a random-suffix slug.
      </div>
    );
  }

  return (
    <>
      <div className="card p-4 mb-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">
            {venues.length} venues with random-suffix slugs
          </div>
          <div className="text-xs text-buzz-mute">
            {freeCount} safe to rename · {collisionCount} have a collision needing manual review
          </div>
        </div>
        <button
          type="button"
          onClick={runBulk}
          disabled={bulkRunning || freeCount === 0}
          className="btn-primary"
        >
          {bulkRunning ? "Renaming…" : `Rename all ${freeCount} safe ones`}
        </button>
      </div>

      {info && <div className="card p-3 mb-3 text-sm text-emerald-400">{info}</div>}
      {error && (
        <pre className="card p-3 mb-3 text-xs text-rose-400 whitespace-pre-wrap">{error}</pre>
      )}

      {venues.length > 0 && (
        <ul className="card divide-y divide-buzz-border/60">
          {venues.map((v) => {
            const busy = busyId === v.id;
            const conflictBadge = v.status === "collision";
            return (
              <li key={v.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">
                    {v.name}
                    {v.citySlug && <span className="text-buzz-mute font-normal"> · {v.citySlug}</span>}
                  </div>
                  <div className="text-xs text-buzz-mute font-mono mt-0.5">
                    <span className="text-rose-400">{v.currentSlug}</span>
                    {" → "}
                    <span className="text-emerald-400">{v.proposedSlug}</span>
                  </div>
                  {conflictBadge && (
                    <div className="text-[11px] mt-1 text-amber-400">
                      ⚠ Base slug clashes with{" "}
                      {v.collidesWith ? <strong>{v.collidesWith.name}</strong> : "another venue"} — using a numbered suffix instead.
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => renameOne(v)}
                  disabled={busy || bulkRunning}
                  className="btn-secondary text-xs px-3 py-1.5 shrink-0"
                >
                  {busy ? "Renaming…" : "Rename"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
