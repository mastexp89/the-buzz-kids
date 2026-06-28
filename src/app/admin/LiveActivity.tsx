"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLiveActivity, type LiveActivity } from "./live-activity-actions";

const POLL_INTERVAL_MS = 30_000;

export default function LiveActivityWidget() {
  const [data, setData] = useState<LiveActivity | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      const res = await getLiveActivity();
      if (cancelled) return;
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setError(null);
      setData(res.data);
      setLoadedAt(Date.now());
    }

    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Pulsing red dot when there's been activity in the last minute,
  // grey when quiet — gives a quick "is the site alive" read.
  const live = (data?.lastMinute ?? 0) > 0;

  return (
    <section className="card border-buzz-accent/30 bg-buzz-card p-5 mb-8">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span
            className={
              "inline-block w-2 h-2 rounded-full " +
              (live ? "bg-rose-500 animate-pulse" : "bg-buzz-mute/50")
            }
            aria-hidden
          />
          <h2 className="font-display text-xl uppercase">Live activity</h2>
        </div>
        <p className="text-xs text-buzz-mute">
          {error
            ? error
            : loadedAt
            ? `Updated ${new Date(loadedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
            : "Loading…"}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <Stat label="Last 1 min" value={data?.lastMinute ?? null} />
        <Stat label="Last 5 min" value={data?.lastFiveMinutes ?? null} />
        <Stat label="Today" value={data?.today ?? null} />
      </div>

      <p className="text-xs text-buzz-mute mb-3">
        Page views (not unique users — one person clicking 5 pages = 5).
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <HotEntity
          label="🔥 Hot venue (last 5min)"
          name={data?.topVenue?.name ?? null}
          views={data?.topVenue?.views ?? null}
          href={
            data?.topVenue?.citySlug && data.topVenue.slug
              ? `/${data.topVenue.citySlug}/venues/${data.topVenue.slug}`
              : null
          }
        />
        <HotEntity
          label="🔥 Hot event (last 5min)"
          name={data?.topEvent?.title ?? null}
          views={data?.topEvent?.views ?? null}
          href={
            data?.topEvent?.citySlug && data.topEvent.id
              ? `/${data.topEvent.citySlug}/events/${data.topEvent.id}`
              : null
          }
        />
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg bg-buzz-bg/60 border border-buzz-border p-3">
      <div className="text-[10px] uppercase tracking-wider text-buzz-mute">{label}</div>
      <div className="font-display text-2xl mt-0.5">
        {value === null ? "—" : value.toLocaleString("en-GB")}
      </div>
    </div>
  );
}

function HotEntity({
  label,
  name,
  views,
  href,
}: {
  label: string;
  name: string | null;
  views: number | null;
  href: string | null;
}) {
  return (
    <div className="rounded-lg bg-buzz-bg/60 border border-buzz-border p-3 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-buzz-mute mb-0.5">{label}</div>
      {name ? (
        <div className="flex items-baseline justify-between gap-2 min-w-0">
          {href ? (
            <Link
              href={href}
              target="_blank"
              className="font-medium truncate hover:text-buzz-accent"
            >
              {name}
            </Link>
          ) : (
            <span className="font-medium truncate">{name}</span>
          )}
          {views !== null && (
            <span className="text-buzz-mute text-xs shrink-0">{views} views</span>
          )}
        </div>
      ) : (
        <div className="text-buzz-mute text-sm">No activity yet</div>
      )}
    </div>
  );
}
