"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  findEventDuplicates,
  mergeEvents,
  type DupeEventGroup,
  type DupeEvent,
} from "./actions";

type Festival = {
  id: string;
  name: string;
  slug: string;
  startDate: string;
  endDate: string;
  published: boolean;
};

export default function EventsDedupeClient({
  festivals,
  initialFestivalSlug,
}: {
  festivals: Festival[];
  initialFestivalSlug: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [scope, setScope] = useState<string>(initialFestivalSlug ?? "all");
  const [phase, setPhase] = useState<"idle" | "scanning" | "reviewing">("idle");
  const [groups, setGroups] = useState<DupeEventGroup[]>([]);
  const [winners, setWinners] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [info, setInfo] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  function scan() {
    setError(null);
    setPhase("scanning");
    setGroups([]);
    setWinners({});
    setResolved(new Set());
    setInfo({});
    startTransition(async () => {
      const festivalId =
        scope === "all" ? null : festivals.find((f) => f.slug === scope)?.id ?? null;
      const res = await findEventDuplicates({ festivalId, days: 180 });
      if ("error" in res) {
        setError(res.error);
        setPhase("idle");
        return;
      }
      setGroups(res.groups);
      const initialWinners: Record<string, string> = {};
      for (const g of res.groups) initialWinners[g.key] = g.events[0].id;
      setWinners(initialWinners);
      setPhase("reviewing");
    });
  }

  function merge(g: DupeEventGroup) {
    const winnerId = winners[g.key];
    if (!winnerId) return;
    const losers = g.events.filter((e) => e.id !== winnerId);
    const winner = g.events.find((e) => e.id === winnerId)!;
    if (
      !confirm(
        `Merge ${losers.length} event(s) into "${winner.title}"?\n\n` +
          `Losers: ${losers.map((l) => `"${l.title}"`).join(", ")}\n\n` +
          `Artists, organisers, genres and favourites will move to the keeper. ` +
          `Blank image/description fields on the keeper will get filled in from the losers. ` +
          `The loser rows are deleted.`,
      )
    ) {
      return;
    }
    setBusyKey(g.key);
    startTransition(async () => {
      const res = await mergeEvents(winnerId, losers.map((l) => l.id));
      setBusyKey(null);
      if ("error" in res) {
        setInfo((m) => ({ ...m, [g.key]: `Error: ${res.error}` }));
        return;
      }
      setResolved((s) => new Set(s).add(g.key));
      const filled =
        res.filledFields.length > 0
          ? ` · filled ${res.filledFields.join(", ")}`
          : "";
      setInfo((m) => ({
        ...m,
        [g.key]:
          `✓ Merged · moved ${res.moved.artists} artists, ${res.moved.organisers} organisers, ` +
          `${res.moved.genres} genres, ${res.moved.favourites} favourites${filled} · ` +
          `deleted ${res.losersDeleted} loser row(s)`,
      }));
      router.refresh();
    });
  }

  return (
    <div>
      <div className="card p-5 mb-6 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className="label">Scope</label>
          <select
            className="input"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            disabled={phase === "scanning"}
          >
            <option value="all">All upcoming events (next 180 days)</option>
            {festivals.map((f) => (
              <option key={f.slug} value={f.slug}>
                {f.name} ({f.startDate}){f.published ? "" : " — draft"}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={scan}
          disabled={phase === "scanning"}
          className="btn-primary"
        >
          {phase === "scanning" ? "Scanning…" : "🔍 Find duplicates"}
        </button>
      </div>

      {error && (
        <div className="card p-3 mb-4 text-sm text-rose-400 border-rose-500/40">
          {error}
        </div>
      )}

      {phase === "reviewing" && groups.length === 0 && (
        <div className="card p-8 text-center text-buzz-mute">
          ✨ No duplicate events found in this scope.
        </div>
      )}

      {phase === "reviewing" && groups.length > 0 && (
        <div>
          <p className="text-sm text-buzz-mute mb-4">
            Found <strong>{groups.length}</strong> duplicate cluster{groups.length === 1 ? "" : "s"}.
            For each group, pick the keeper (auto-selected the one with the most artists / longest description), then hit Merge.
          </p>

          <div className="flex flex-col gap-4">
            {groups.map((g) => {
              const isResolved = resolved.has(g.key);
              const winnerId = winners[g.key];
              return (
                <div
                  key={g.key}
                  className={
                    "card p-4 " +
                    (isResolved ? "opacity-60 border-emerald-500/30" : "border-buzz-accent/30")
                  }
                >
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <div className="text-xs uppercase tracking-wider text-buzz-mute">
                      <strong className="text-buzz-fg">{g.venueName}</strong>
                      <span> · {formatDay(g.day)}</span>
                      <span> · {g.events.length} candidates</span>
                    </div>
                    {!isResolved && (
                      <button
                        type="button"
                        onClick={() => merge(g)}
                        disabled={busyKey === g.key}
                        className="btn-primary text-sm"
                      >
                        {busyKey === g.key
                          ? "Merging…"
                          : `Merge ${g.events.length - 1} into keeper`}
                      </button>
                    )}
                  </div>
                  <ul className="divide-y divide-buzz-border/60">
                    {g.events.map((e) => (
                      <EventRow
                        key={e.id}
                        event={e}
                        isWinner={e.id === winnerId}
                        disabled={isResolved}
                        onPick={() =>
                          setWinners((w) => ({ ...w, [g.key]: e.id }))
                        }
                      />
                    ))}
                  </ul>
                  {info[g.key] && (
                    <p
                      className={
                        "text-xs mt-2 " +
                        (info[g.key].startsWith("Error")
                          ? "text-rose-400"
                          : "text-emerald-400")
                      }
                    >
                      {info[g.key]}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function EventRow({
  event,
  isWinner,
  disabled,
  onPick,
}: {
  event: DupeEvent;
  isWinner: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  const time = new Date(event.start_time).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
  const eventHref =
    event.city_slug && event.venue_slug
      ? `/${event.city_slug}/events/${event.id}`
      : null;
  return (
    <li className="py-2 flex items-start gap-3">
      <input
        type="radio"
        checked={isWinner}
        disabled={disabled}
        onChange={onPick}
        className="mt-1 w-4 h-4 cursor-pointer accent-buzz-accent shrink-0"
        aria-label={`Keep ${event.title}`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate">{event.title}</span>
          {isWinner && (
            <span className="text-[10px] uppercase bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded">
              Keeper
            </span>
          )}
          <span className="text-xs text-buzz-mute">· {time}</span>
          {event.artist_count > 0 && (
            <span className="text-xs text-buzz-mute">
              · 🎤 {event.artist_count}
            </span>
          )}
          {event.organiser_count > 0 && (
            <span className="text-xs text-buzz-mute">
              · 📋 {event.organiser_count}
            </span>
          )}
          {event.image_url && <span className="text-xs text-buzz-mute">· 🖼️</span>}
          {event.description_length > 0 && (
            <span className="text-xs text-buzz-mute">
              · {event.description_length}c desc
            </span>
          )}
          {event.auto_imported_from && (
            <span className="text-xs text-buzz-mute">
              · 🤖 {event.auto_imported_from}
              {event.auto_import_confidence != null
                ? ` (${Math.round(event.auto_import_confidence * 100)}%)`
                : ""}
            </span>
          )}
          {!event.auto_imported_from && (
            <span className="text-xs text-buzz-mute">· ✋ manual</span>
          )}
        </div>
        <div className="text-xs text-buzz-mute truncate">
          {event.festival_name && <span>🎵 {event.festival_name} · </span>}
          created {formatRelative(event.created_at)}
        </div>
      </div>
      {eventHref && (
        <Link
          href={eventHref}
          target="_blank"
          className="text-xs text-buzz-mute hover:text-buzz-accent shrink-0"
        >
          View ↗
        </Link>
      )}
    </li>
  );
}

function formatDay(day: string): string {
  const d = new Date(day + "T00:00:00");
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return "<1d ago";
  const days = Math.round(diff / day);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}
