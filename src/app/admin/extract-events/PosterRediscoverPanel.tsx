"use client";

// Re-fetches each event's stored source URL and grabs the og:image / featured
// image off it. Use this to fix old imports that have a site logo or wrong
// poster — the importer used to pick the first <img> tag, now it prefers
// og:image. Running this against existing events backfills the improvement.

import { useState, useTransition } from "react";
import {
  listRediscoverCandidates,
  rediscoverPosterFromSource,
  type RediscoverCandidate,
  type RediscoverResult,
} from "./actions";

type Row = RediscoverCandidate & {
  state: "idle" | "running" | "ok" | "error" | "unchanged";
  message?: string;
  newImage?: string;
};

export default function PosterRediscoverPanel() {
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  function load() {
    setError(null);
    start(async () => {
      try {
        const data = await listRediscoverCandidates();
        setRows(data.map((r) => ({ ...r, state: "idle" as const })));
      } catch (e: any) {
        setError(e?.message ?? "Failed to load");
      }
    });
  }

  async function runOne(idx: number) {
    if (!rows) return;
    const eventId = rows[idx].id;
    setRows((prev) => prev?.map((r, i) => i === idx ? { ...r, state: "running" } : r) ?? null);
    let result: RediscoverResult;
    try {
      result = await rediscoverPosterFromSource(eventId);
    } catch (e: any) {
      setRows((prev) => prev?.map((r, i) =>
        i === idx ? { ...r, state: "error", message: e?.message ?? "failed" } : r,
      ) ?? null);
      return;
    }
    setRows((prev) => prev?.map((r, i) => {
      if (i !== idx) return r;
      if ("ok" in result) {
        return result.updated
          ? { ...r, state: "ok", message: "Updated", newImage: result.publicUrl }
          : { ...r, state: "unchanged", message: "Same as before" };
      }
      return { ...r, state: "error", message: result.error };
    }) ?? null);
  }

  async function runAll() {
    if (!rows || bulkRunning) return;
    setBulkRunning(true);
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].state === "ok" || rows[i].state === "unchanged") continue;
      // eslint-disable-next-line no-await-in-loop
      await runOne(i);
    }
    setBulkRunning(false);
  }

  const okCount = rows?.filter((r) => r.state === "ok").length ?? 0;
  const sameCount = rows?.filter((r) => r.state === "unchanged").length ?? 0;
  const errCount = rows?.filter((r) => r.state === "error").length ?? 0;
  const pendingCount = rows?.filter((r) => r.state === "idle").length ?? 0;

  return (
    <section className="card p-5 mt-6">
      <h2 className="h-display text-2xl mb-1">🔄 Rediscover posters from source</h2>
      <p className="text-buzz-mute text-sm mb-4 max-w-2xl">
        Re-fetches each event's source URL and pulls the og:image / featured
        image off it. Useful for old imports that have the site logo instead of
        the actual event poster. <strong>Skips Facebook-sourced events</strong> —
        FB pages aren't directly fetchable, so their posters can't be re-grabbed
        this way.
      </p>

      {!rows && (
        <button
          type="button"
          onClick={load}
          disabled={pending}
          className="btn-secondary"
        >
          {pending ? "Loading…" : "Find candidates"}
        </button>
      )}

      {error && <div className="text-rose-400 text-sm mt-3">{error}</div>}

      {rows && (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <span className="text-sm text-buzz-mute">
              {rows.length} candidate{rows.length === 1 ? "" : "s"}
              {okCount > 0 && ` · ${okCount} updated`}
              {sameCount > 0 && ` · ${sameCount} unchanged`}
              {errCount > 0 && ` · ${errCount} failed`}
            </span>
            <button
              type="button"
              onClick={runAll}
              disabled={bulkRunning || pendingCount === 0}
              className="btn-primary"
            >
              {bulkRunning ? "Running…" : `Run all (${pendingCount})`}
            </button>
            <button
              type="button"
              onClick={load}
              disabled={pending || bulkRunning}
              className="btn-secondary"
            >
              Refresh
            </button>
          </div>

          {rows.length === 0 ? (
            <div className="text-buzz-mute text-sm">
              Nothing to rediscover — no events with a fetchable source URL.
            </div>
          ) : (
            <div className="grid gap-1.5 max-h-[500px] overflow-auto">
              {rows.map((r, i) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-md bg-buzz-surface border border-buzz-border text-sm"
                >
                  <ImageBox url={r.newImage ?? r.currentImage} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{r.title}</div>
                    <div className="text-[11px] text-buzz-mute truncate">
                      {r.source ?? "—"} · {r.sourceUrl}
                    </div>
                  </div>
                  <div className="text-xs w-32 text-right shrink-0">
                    {r.state === "idle" && <span className="text-buzz-mute">pending</span>}
                    {r.state === "running" && <span className="text-buzz-accent">running…</span>}
                    {r.state === "ok" && <span className="text-emerald-400">✓ {r.message}</span>}
                    {r.state === "unchanged" && <span className="text-buzz-mute">= same image</span>}
                    {r.state === "error" && <span className="text-rose-400" title={r.message}>✗ {r.message?.slice(0, 30)}</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => runOne(i)}
                    disabled={r.state === "running" || bulkRunning}
                    className="chip"
                  >
                    Retry
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ImageBox({ url }: { url: string | null | undefined }) {
  if (!url) {
    return <div className="w-10 h-10 rounded bg-buzz-surface border border-buzz-border grid place-items-center text-sm">–</div>;
  }
  return (
    <div
      className="w-10 h-10 rounded bg-buzz-surface border border-buzz-border shrink-0"
      style={{
        backgroundImage: `url(${url})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    />
  );
}
