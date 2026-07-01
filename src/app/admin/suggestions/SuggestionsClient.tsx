"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { setSuggestionStatus, deleteSuggestion } from "./actions";

type Suggestion = {
  id: string;
  target_type: "venue" | "event" | "new_place";
  target_id: string | null;
  target_name: string | null;
  city_slug: string | null;
  reason: string | null;
  details: string | null;
  contact_name: string | null;
  contact_email: string | null;
  is_owner: boolean;
  status: "new" | "reviewed" | "done";
  image_url: string | null;
  created_at: string;
};

const TYPE_META: Record<Suggestion["target_type"], { label: string; emoji: string }> = {
  venue: { label: "Place", emoji: "📍" },
  event: { label: "Event", emoji: "🎟️" },
  new_place: { label: "New place", emoji: "✨" },
};

// Where in admin to go to action this suggestion. Venue/new-place → the main
// admin search (by name); event → the events search.
function adminHref(s: Suggestion): string | null {
  const q = encodeURIComponent(s.target_name ?? "");
  if (s.target_type === "event") return `/admin/events?q=${q}`;
  if (s.target_name) return `/admin?q=${q}`;
  return null;
}

export default function SuggestionsClient({ suggestions }: { suggestions: Suggestion[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, start] = useTransition();

  const open = suggestions.filter((s) => s.status !== "done");
  const done = suggestions.filter((s) => s.status === "done");

  function act(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    start(async () => {
      await fn();
      setBusyId(null);
      router.refresh();
    });
  }

  const row = (s: Suggestion) => {
    const meta = TYPE_META[s.target_type];
    const href = adminHref(s);
    const when = new Date(s.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    return (
      <li key={s.id} className="p-4 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider bg-buzz-surface border border-buzz-border rounded px-1.5 py-0.5">
                {meta.emoji} {meta.label}
              </span>
              {s.is_owner && (
                <span className="text-[10px] uppercase tracking-wider bg-amber-500/15 text-amber-600 rounded px-1.5 py-0.5" title="Says they run this place">
                  ✋ Owner
                </span>
              )}
              {s.reason && <span className="text-xs text-buzz-mute">{s.reason}</span>}
              <span className="text-xs text-buzz-mute/70">· {when}</span>
            </div>
            <div className="font-medium mt-1">
              {href ? (
                <Link href={href} className="hover:text-buzz-accent transition">{s.target_name ?? "—"}</Link>
              ) : (
                s.target_name ?? "—"
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {s.status !== "done" ? (
              <button onClick={() => act(s.id, () => setSuggestionStatus(s.id, "done"))} disabled={busyId === s.id} className="btn-primary text-xs disabled:opacity-60">
                {busyId === s.id ? "…" : "Mark done"}
              </button>
            ) : (
              <button onClick={() => act(s.id, () => setSuggestionStatus(s.id, "new"))} disabled={busyId === s.id} className="btn-secondary text-xs disabled:opacity-60">
                {busyId === s.id ? "…" : "Reopen"}
              </button>
            )}
            <button
              onClick={() => { if (confirm("Delete this suggestion?")) act(s.id, () => deleteSuggestion(s.id)); }}
              disabled={busyId === s.id}
              className="btn-danger text-xs disabled:opacity-60"
            >
              Delete
            </button>
          </div>
        </div>

        {s.details && <p className="text-sm text-buzz-text/90 whitespace-pre-line">{s.details}</p>}

        {s.image_url && (
          <a href={s.image_url} target="_blank" rel="noreferrer" className="inline-block">
            <img
              src={s.image_url}
              alt="Attached poster / photo"
              className="h-28 rounded-lg border border-buzz-border object-contain bg-buzz-surface hover:border-buzz-accent transition"
            />
          </a>
        )}

        {(s.contact_name || s.contact_email) && (
          <p className="text-xs text-buzz-mute">
            ✉️ {[s.contact_name, s.contact_email].filter(Boolean).join(" · ")}
            {s.contact_email && (
              <> — <a href={`mailto:${s.contact_email}`} className="text-buzz-accent hover:underline">reply</a></>
            )}
          </p>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="font-display text-xl uppercase mb-2">
          To action <span className="text-buzz-mute text-sm font-normal">({open.length})</span>
        </h2>
        {open.length === 0 ? (
          <div className="card p-6 text-buzz-mute text-sm">Nothing waiting. ✨</div>
        ) : (
          <ul className="card divide-y divide-buzz-border/60">{open.map(row)}</ul>
        )}
      </div>

      {done.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none flex items-center gap-2 mb-3 hover:text-buzz-accent transition">
            <span className="inline-block transition-transform group-open:rotate-90 text-buzz-mute">▶</span>
            <h2 className="font-display text-xl uppercase inline">
              Done <span className="text-buzz-mute text-sm font-normal">({done.length})</span>
            </h2>
          </summary>
          <ul className="card divide-y divide-buzz-border/60">{done.map(row)}</ul>
        </details>
      )}
    </div>
  );
}
