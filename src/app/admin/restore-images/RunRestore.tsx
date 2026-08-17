"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { runImageRestore } from "./actions";

export default function RunRestore({ startRemaining }: { startRemaining: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ processed: number; restored: number; remaining: number } | null>(null);
  const [failures, setFailures] = useState<{ name: string; reason: string }[]>([]);

  async function run() {
    setBusy(true); setDone(false); setError(null); setFailures([]);
    let processed = 0, restored = 0;
    try {
      for (;;) {
        const r = await runImageRestore();
        if (r.error) { setError(r.error); break; }
        processed += r.processed;
        restored += r.restored;
        setStats({ processed, restored, remaining: r.remaining });
        setFailures((f) => [...f, ...r.failures].slice(0, 40));
        router.refresh();
        if (r.remaining === 0 || r.processed === 0) { setDone(true); break; }
      }
    } catch (e: any) {
      setError(e?.message ?? "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  const pct = stats && stats.processed > 0 ? Math.round((stats.restored / stats.processed) * 100) : 0;

  return (
    <div>
      <button onClick={run} disabled={busy} className="btn-primary text-sm disabled:opacity-50">
        {busy ? "Restoring images…" : startRemaining > 0 ? `🖼️ Restore images (${startRemaining} to do)` : "🖼️ Restore images"}
      </button>
      {busy && (
        <p className="text-xs text-buzz-mute mt-2">
          Reading each venue&apos;s own website and re-hosting their picture — keep this tab open. Free (no paid API).
        </p>
      )}
      {error && <p className="text-sm text-rose-500 mt-2">{error}</p>}

      {stats && (
        <div className="mt-3 text-sm">
          <p style={{ color: done ? "#3B6D11" : undefined }}>
            {done ? "✅ Finished — " : "Working… "}
            checked <strong>{stats.processed}</strong> · restored <strong>{stats.restored}</strong> ({pct}% hit rate)
            {stats.remaining > 0 ? ` · ${stats.remaining} to go` : ""}.
          </p>
          {failures.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs text-buzz-mute cursor-pointer hover:text-buzz-accent">
                {failures.length} couldn&apos;t be restored (they keep the 🐝 placeholder)
              </summary>
              <ul className="mt-1 text-[11px] text-buzz-mute space-y-0.5 list-disc pl-4">
                {failures.map((f, i) => <li key={i}>{f.name} — {f.reason}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
