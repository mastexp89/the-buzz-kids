import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import AnalyticsClient from "./AnalyticsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics — The Buzz Kids admin" };

type WindowKey = "7" | "30" | "all";
const WINDOW_LABELS: Record<WindowKey, string> = {
  "7": "7d",
  "30": "30d",
  "all": "all",
};

function windowStart(key: WindowKey): string | null {
  if (key === "all") return null;
  const days = key === "7" ? 7 : 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

type Props = { searchParams: Promise<{ window?: string }> };

export default async function AnalyticsPage({ searchParams }: Props) {
  const supabase = await createClient();
  const sp = await searchParams;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/dashboard" className="btn-secondary mt-6 inline-block">Back to dashboard</Link>
      </div>
    );
  }

  const windowKey: WindowKey = (sp.window === "7" || sp.window === "30" || sp.window === "all" ? sp.window : "30") as WindowKey;
  const since = windowStart(windowKey);

  // Service role for the aggregate scans
  const sb = createServiceClient();

  // Paginate through ALL page_views in the window — PostgREST defaults to
  // a 1000-row cap, which silently truncated higher-traffic days and made
  // the same day show different totals depending on which window the user
  // picked. We loop with .range() until the page comes back short.
  //
  // Bound at 200k rows so a runaway crawler can't lock the admin page up.
  const rows: { venue_id: string | null; event_id: string | null; kind: string | null; viewed_at: string }[] = [];
  const pageSize = 1000;
  const maxRows = 200_000;
  for (let from = 0; from < maxRows; from += pageSize) {
    let q = sb.from("page_views").select("venue_id, event_id, kind, viewed_at");
    if (since) q = q.gte("viewed_at", since);
    q = q.order("viewed_at", { ascending: true }).range(from, from + pageSize - 1);
    const { data, error } = await q;
    if (error || !data || data.length === 0) break;
    rows.push(...(data as any[]));
    if (data.length < pageSize) break;
  }

  // Two parallel sets of counters: page views (kind = 'view') and clicks (everything else).
  type Counters = { views: number; clicks: number; clicksByKind: Record<string, number> };
  const venueStats = new Map<string, Counters>();
  const eventStats = new Map<string, Counters>();
  let totalViews = 0;
  let totalClicks = 0;

  function bucket(map: Map<string, Counters>, id: string): Counters {
    let c = map.get(id);
    if (!c) {
      c = { views: 0, clicks: 0, clicksByKind: {} };
      map.set(id, c);
    }
    return c;
  }

  for (const r of rows ?? []) {
    const isView = !r.kind || r.kind === "view";
    if (isView) totalViews++; else totalClicks++;
    const kind = r.kind || "view";
    const apply = (map: Map<string, Counters>, id: string) => {
      const c = bucket(map, id);
      if (isView) c.views++;
      else {
        c.clicks++;
        c.clicksByKind[kind] = (c.clicksByKind[kind] ?? 0) + 1;
      }
    };
    if (r.venue_id) apply(venueStats, r.venue_id);
    if (r.event_id) apply(eventStats, r.event_id);
  }

  // Daily bucket — one entry per calendar day in the current window
  // (Europe/London). Pre-fills every day with zero so the chart shows
  // gaps for quiet days instead of skipping them. Cap at 90 days for
  // the "all" window so the bar chart stays readable.
  const dailyMap = new Map<string, { views: number; clicks: number }>();
  const dayKey = (iso: string) =>
    new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  // Pre-fill the calendar so missing days show as zero bars
  const dailyWindowDays =
    windowKey === "7" ? 7 : windowKey === "30" ? 30 : 90;
  for (let i = dailyWindowDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    dailyMap.set(dayKey(d.toISOString()), { views: 0, clicks: 0 });
  }
  for (const r of rows ?? []) {
    if (!r.viewed_at) continue;
    const key = dayKey(r.viewed_at as string);
    const bucket = dailyMap.get(key);
    if (!bucket) continue; // outside the chart window
    const isView = !r.kind || r.kind === "view";
    if (isView) bucket.views += 1;
    else bucket.clicks += 1;
  }
  const dailyAll = Array.from(dailyMap.entries())
    .map(([day, c]) => ({ day, views: c.views, clicks: c.clicks }))
    .sort((a, b) => a.day.localeCompare(b.day)); // oldest → newest

  // Trim leading zero-days — no point showing 20 empty rows for days
  // before tracking actually started. Always keeps today even if it's
  // currently zero so the chart still has a "today" anchor.
  let firstWithData = 0;
  while (
    firstWithData < dailyAll.length - 1 &&
    dailyAll[firstWithData].views === 0 &&
    dailyAll[firstWithData].clicks === 0
  ) {
    firstWithData++;
  }
  const daily = dailyAll.slice(firstWithData);

  const topVenueIds = topNStats(venueStats, 30);
  const topEventIds = topNStats(eventStats, 20);

  const [{ data: venues }, { data: events }] = await Promise.all([
    topVenueIds.length > 0
      ? sb.from("venues").select("id, name, slug, city:cities(slug)").in("id", topVenueIds.map((t) => t.id))
      : Promise.resolve({ data: [] as any[] }),
    topEventIds.length > 0
      ? sb.from("events").select("id, title, start_time, venue:venues(name, slug, city:cities(slug))").in("id", topEventIds.map((t) => t.id))
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const venueRows = topVenueIds.map((t) => {
    const v = (venues ?? []).find((x: any) => x.id === t.id);
    return { ...t, venue: v };
  });
  const eventRows = topEventIds.map((t) => {
    const e = (events ?? []).find((x: any) => x.id === t.id);
    return { ...t, event: e };
  });

  return (
    <div className="container-page py-10 max-w-5xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">Analytics</h1>
      <p className="text-buzz-mute mb-6 max-w-2xl">
        Page views per place and session. Bot traffic filtered out server-side. Tracking started when migration <code>014_analytics.sql</code> was applied — historical data not available before that.
      </p>

      <AnalyticsClient
        windowKey={windowKey}
        windowLabel={WINDOW_LABELS[windowKey]}
        totalViews={totalViews}
        totalClicks={totalClicks}
        daily={daily}
        venueRows={venueRows as any}
        eventRows={eventRows as any}
      />
    </div>
  );
}

function topNStats(
  counts: Map<string, { views: number; clicks: number; clicksByKind: Record<string, number> }>,
  n: number,
): { id: string; views: number; clicks: number; clicksByKind: Record<string, number> }[] {
  return Array.from(counts.entries())
    .map(([id, c]) => ({ id, ...c }))
    .sort((a, b) => (b.views + b.clicks) - (a.views + a.clicks))
    .slice(0, n);
}
