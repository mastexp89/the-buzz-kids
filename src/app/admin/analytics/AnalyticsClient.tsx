"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type WindowKey = "7" | "30" | "all";

type Stats = {
  views: number;
  clicks: number;
  clicksByKind: Record<string, number>;
};
type VenueRow = Stats & {
  id: string;
  venue?: { name: string; slug: string; city?: { slug: string } | null };
};
type EventRow = Stats & {
  id: string;
  event?: {
    title: string;
    start_time: string;
    venue?: { name: string; slug: string; city?: { slug: string } | null };
  };
};

function topClickSummary(byKind: Record<string, number>): string {
  // e.g. "phone 3 · maps 2 · website 1"
  return Object.entries(byKind)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, v]) => `${k.replace(/^click_/, "")} ${v}`)
    .join(" · ");
}

type DailyRow = { day: string; views: number; clicks: number };

export default function AnalyticsClient({
  windowKey,
  windowLabel,
  totalViews,
  totalClicks,
  daily,
  venueRows,
  eventRows,
}: {
  windowKey: WindowKey;
  windowLabel: string;
  totalViews: number;
  totalClicks: number;
  daily: DailyRow[];
  venueRows: VenueRow[];
  eventRows: EventRow[];
}) {
  const router = useRouter();
  const search = useSearchParams();

  function setWindow(w: WindowKey) {
    const params = new URLSearchParams(search?.toString() ?? "");
    params.set("window", w);
    router.push(`/admin/analytics?${params.toString()}`);
  }

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap mb-6">
        <span className="text-buzz-mute text-sm mr-1">Window:</span>
        <Pill label="Last 7 days"  active={windowKey === "7"}   onClick={() => setWindow("7")} />
        <Pill label="Last 30 days" active={windowKey === "30"}  onClick={() => setWindow("30")} />
        <Pill label="All time"     active={windowKey === "all"} onClick={() => setWindow("all")} />
        <span className="ml-auto text-sm text-buzz-mute">
          <strong className="text-buzz-text">{totalViews.toLocaleString()}</strong> views ·{" "}
          <strong className="text-buzz-text">{totalClicks.toLocaleString()}</strong> clicks ({windowLabel})
        </span>
      </div>

      <section className="mb-10">
        <h2 className="font-display text-2xl uppercase mb-3">
          Daily traffic
          <span className="text-buzz-mute text-sm font-normal">
            {" "}({daily.length} {daily.length === 1 ? "day" : "days"})
          </span>
        </h2>
        <DailyBars rows={daily} />
      </section>

      <section className="mb-10">
        <h2 className="font-display text-2xl uppercase mb-3">
          Top places <span className="text-buzz-mute text-sm font-normal">({venueRows.length})</span>
        </h2>
        {venueRows.length === 0 ? (
          <Empty />
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-buzz-surface/40 text-xs uppercase tracking-wide text-buzz-mute">
                <tr>
                  <th className="text-left px-4 py-3 w-10">#</th>
                  <th className="text-left px-4 py-3">Place</th>
                  <th className="text-right px-4 py-3 w-20">Views</th>
                  <th className="text-right px-4 py-3 w-20">Clicks</th>
                  <th className="text-left px-4 py-3">Top click types</th>
                </tr>
              </thead>
              <tbody>
                {venueRows.map((r, i) => (
                  <tr key={r.id} className="border-t border-buzz-border/40 hover:bg-buzz-surface/20">
                    <td className="px-4 py-2 text-buzz-mute">{i + 1}</td>
                    <td className="px-4 py-2">
                      {r.venue ? (
                        <Link
                          href={`/${r.venue.city?.slug ?? "dundee"}/venues/${r.venue.slug}`}
                          target="_blank"
                          className="hover:text-buzz-accent"
                        >
                          {r.venue.name}
                        </Link>
                      ) : (
                        <span className="text-buzz-mute italic">Deleted place ({r.id.slice(0, 8)}…)</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{r.views.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-mono">{r.clicks.toLocaleString()}</td>
                    <td className="px-4 py-2 text-xs text-buzz-mute font-mono truncate">
                      {topClickSummary(r.clicksByKind) || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-4">
        <h2 className="font-display text-2xl uppercase mb-3">
          Top sessions <span className="text-buzz-mute text-sm font-normal">({eventRows.length})</span>
        </h2>
        {eventRows.length === 0 ? (
          <Empty />
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-buzz-surface/40 text-xs uppercase tracking-wide text-buzz-mute">
                <tr>
                  <th className="text-left px-4 py-3 w-10">#</th>
                  <th className="text-left px-4 py-3">Event</th>
                  <th className="text-left px-4 py-3">Place</th>
                  <th className="text-right px-4 py-3 w-24">Views</th>
                </tr>
              </thead>
              <tbody>
                {eventRows.map((r, i) => (
                  <tr key={r.id} className="border-t border-buzz-border/40 hover:bg-buzz-surface/20">
                    <td className="px-4 py-2 text-buzz-mute">{i + 1}</td>
                    <td className="px-4 py-2">
                      {r.event ? (
                        <Link
                          href={`/${r.event.venue?.city?.slug ?? "dundee"}/events/${r.id}`}
                          target="_blank"
                          className="hover:text-buzz-accent"
                        >
                          {r.event.title}
                        </Link>
                      ) : (
                        <span className="text-buzz-mute italic">Deleted</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-buzz-mute">{r.event?.venue?.name ?? "—"}</td>
                    <td className="px-4 py-2 text-right font-mono">{r.views.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "px-3 py-1.5 rounded-full text-sm font-semibold bg-buzz-accent text-black"
          : "px-3 py-1.5 rounded-full text-sm bg-buzz-card border border-buzz-border hover:border-buzz-accent transition"
      }
    >
      {label}
    </button>
  );
}

function Empty() {
  return <div className="card p-8 text-buzz-mute text-center text-sm">No views recorded in this window yet.</div>;
}

function DailyBars({ rows }: { rows: DailyRow[] }) {
  if (rows.length === 0) {
    return <Empty />;
  }
  // Scale bars to the busiest day so the smallest still has a visible
  // size, but a "0" day shows as truly empty.
  const max = Math.max(1, ...rows.map((r) => r.views + r.clicks));
  const total = rows.reduce((sum, r) => sum + r.views + r.clicks, 0);
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

  return (
    <div className="card p-4 sm:p-5">
      <div className="text-xs text-buzz-mute mb-3">
        Each bar = one day. Yellow = page views, rose = link clicks (Maps,
        phone, socials, ticket links etc.). Hover for the exact counts.
        Total in window: <strong className="text-buzz-fg">{total.toLocaleString()}</strong>.
      </div>
      <div className="flex flex-col gap-0.5">
        {rows.map((r) => {
          const all = r.views + r.clicks;
          const isToday = r.day === todayKey;
          const pct = (all / max) * 100;
          const viewsPct = all === 0 ? 0 : (r.views / all) * pct;
          const clicksPct = all === 0 ? 0 : (r.clicks / all) * pct;
          const dayLabel = (() => {
            const d = new Date(`${r.day}T12:00:00Z`);
            return d.toLocaleDateString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
            });
          })();
          return (
            <div
              key={r.day}
              className="grid grid-cols-[100px_1fr_60px] gap-2 items-center group hover:bg-buzz-surface/30 rounded px-1.5 py-1"
              title={`${dayLabel} — ${r.views} views, ${r.clicks} clicks`}
            >
              <div className={`text-xs ${isToday ? "text-buzz-accent font-semibold" : "text-buzz-mute"}`}>
                {dayLabel}{isToday ? " · today" : ""}
              </div>
              <div className="h-3 bg-buzz-surface/40 rounded overflow-hidden relative">
                {viewsPct > 0 && (
                  <div
                    className="absolute inset-y-0 left-0 bg-buzz-accent/70 rounded-l"
                    style={{ width: `${viewsPct}%` }}
                  />
                )}
                {clicksPct > 0 && (
                  <div
                    className="absolute inset-y-0 bg-rose-500/70"
                    style={{ left: `${viewsPct}%`, width: `${clicksPct}%` }}
                  />
                )}
              </div>
              <div className="text-xs font-mono text-right text-buzz-mute group-hover:text-buzz-fg">
                {all > 0 ? all.toLocaleString() : "—"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
