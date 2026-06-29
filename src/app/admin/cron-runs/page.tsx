import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCronDailyStats, getFbScrapeBudget } from "./actions";
import CronRunButtons from "./CronRunButtons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cron runs — The Buzz Kids admin" };

export default async function CronRunsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/dashboard" className="btn-secondary mt-6 inline-block">Back to dashboard</Link>
      </div>
    );
  }

  const [days, budget] = await Promise.all([
    getCronDailyStats(30),
    getFbScrapeBudget(),
  ]);

  // Fetch cities for the FB-scrape scope picker (active or hidden — admin
  // may want to scrape a hidden city while populating it).
  const { data: cities } = await supabase
    .from("cities")
    .select("name, slug, active")
    .order("name");

  // Totals across the window for the header
  const totals = days.reduce(
    (acc, d) => ({
      fbVenuesScraped: acc.fbVenuesScraped + d.fbVenuesScraped,
      fbEventsCreated: acc.fbEventsCreated + d.fbEventsCreated,
      fbEventsSkipped: acc.fbEventsSkipped + d.fbEventsSkipped,
      fbErrors: acc.fbErrors + d.fbErrors,
      coverPhotosPopulated: acc.coverPhotosPopulated + d.coverPhotosPopulated,
      manualEventsCreated: acc.manualEventsCreated + d.manualEventsCreated,
      eventsRejected: acc.eventsRejected + d.eventsRejected,
    }),
    {
      fbVenuesScraped: 0,
      fbEventsCreated: 0,
      fbEventsSkipped: 0,
      fbErrors: 0,
      coverPhotosPopulated: 0,
      manualEventsCreated: 0,
      eventsRejected: 0,
    },
  );

  return (
    <div className="container-page py-10 max-w-6xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">⏱️ Cron runs</h1>
      <p className="text-buzz-mute mb-8 max-w-2xl">
        Daily output of the scheduled jobs. FB scraper runs every 5 min from 21:00–23:55 UTC on Mon + Thu,
        the dedupe pass runs every day at 03:00 UTC. Stats below are derived from
        the events / venues tables — days with zero activity still show.
      </p>

      <CronRunButtons
        cities={(cities ?? []).map((c: any) => ({
          slug: c.slug,
          name: c.name,
          active: !!c.active,
        }))}
      />

      {budget && <FbScrapeBudgetPanel budget={budget} />}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
        <Stat label="FB venues scraped (30d)" value={totals.fbVenuesScraped} />
        <Stat label="FB events created (30d)" value={totals.fbEventsCreated} />
        <Stat label="Cover photos pulled (30d)" value={totals.coverPhotosPopulated} />
        <Stat label="Manual events (30d)" value={totals.manualEventsCreated} />
        <Stat label="Rejected events (30d)" value={totals.eventsRejected} />
      </div>

      {(totals.fbEventsSkipped > 0 || totals.fbErrors > 0) && (
        <div className="grid grid-cols-2 gap-3 mb-8 -mt-4">
          <Stat
            label="FB events skipped as duplicates (30d)"
            value={totals.fbEventsSkipped}
            hint="Posts that produced an event the AI extracted, but a similar row already existed at the same venue + hour. High here = dedup eating recurring weekly stuff. Low here + low Events created = quiet news cycle."
          />
          <Stat
            label="FB scrape errors (30d)"
            value={totals.fbErrors}
            hint="Per-venue extraction failures (Anthropic / Apify hiccups). High here = something's wrong with the pipeline."
          />
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-buzz-surface">
            <tr className="text-left">
              <Th>Date</Th>
              <Th>FB</Th>
              <Th>Venues scraped</Th>
              <Th>Events from FB</Th>
              <Th>Skipped (dedup)</Th>
              <Th>Errors</Th>
              <Th>Cover photos</Th>
              <Th>Manual events</Th>
              <Th>Rejected</Th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const isQuiet =
                d.fbVenuesScraped === 0 &&
                d.fbEventsCreated === 0 &&
                d.coverPhotosPopulated === 0 &&
                d.manualEventsCreated === 0 &&
                d.eventsRejected === 0;
              const fbExpectedButQuiet = d.fbExpected && d.fbVenuesScraped === 0;
              return (
                <tr key={d.date} className={`border-t border-buzz-border/60 ${isQuiet ? "text-buzz-mute" : ""}`}>
                  <Td>
                    <div className="font-medium">{d.weekday} {formatShortDate(d.date)}</div>
                    <div className="text-[10px] text-buzz-mute">{d.date}</div>
                  </Td>
                  <Td>
                    {d.fbExpected ? (
                      fbExpectedButQuiet ? (
                        <span className="text-rose-400 text-[10px] font-bold uppercase">expected · 0 ran</span>
                      ) : (
                        <span className="text-emerald-400 text-[10px] font-bold uppercase">scheduled</span>
                      )
                    ) : (
                      <span className="text-buzz-mute text-[10px]">—</span>
                    )}
                  </Td>
                  <Td>{d.fbVenuesScraped > 0 ? d.fbVenuesScraped : "—"}</Td>
                  <Td>{d.fbEventsCreated > 0 ? <strong className="text-buzz-accent">{d.fbEventsCreated}</strong> : "—"}</Td>
                  <Td title="Posts the AI extracted as events, then the dedup filter caught because a similar row already existed at this venue+hour. High here on a 0-events day = the cron ran fine, recurring stuff just already exists.">
                    {d.fbEventsSkipped > 0
                      ? <span className="text-amber-400">{d.fbEventsSkipped}</span>
                      : "—"}
                  </Td>
                  <Td title="Per-venue extraction failures — Apify or Anthropic hiccups. Look in fb_scrape_venue_runs.error to see the message.">
                    {d.fbErrors > 0
                      ? <span className="text-rose-400 font-bold">{d.fbErrors}</span>
                      : "—"}
                  </Td>
                  <Td>{d.coverPhotosPopulated > 0 ? d.coverPhotosPopulated : "—"}</Td>
                  <Td>{d.manualEventsCreated > 0 ? d.manualEventsCreated : "—"}</Td>
                  <Td>{d.eventsRejected > 0 ? <span className="text-rose-400">{d.eventsRejected}</span> : "—"}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-buzz-mute mt-4">
        Note: stats are derived from <code>events.created_at</code> and <code>venues.last_facebook_scrape</code>. If the FB cron timed out and didn't update <code>last_facebook_scrape</code>, the row may show "expected · 0 ran" even if some venues were partially processed. Check Vercel logs if a scheduled run looks empty.
      </p>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="card p-3" title={hint}>
      <div className="text-2xl font-bold text-buzz-accent leading-tight">{value}</div>
      <div className="text-[10px] text-buzz-mute uppercase tracking-wider mt-0.5">{label}</div>
      {hint && <div className="text-[10px] text-buzz-mute/70 mt-1 leading-snug">{hint.slice(0, 80)}{hint.length > 80 ? "…" : ""}</div>}
    </div>
  );
}

// Surfaces what the dormancy tier saves vs. scraping every venue twice
// weekly. Helps the admin see whether the cost-saving filter is actually
// kicking in (or whether everyone's been classified active).
function FbScrapeBudgetPanel({
  budget,
}: {
  budget: NonNullable<Awaited<ReturnType<typeof getFbScrapeBudget>>>;
}) {
  const saved = budget.scrapesPerMonthIfAllActive - budget.totalScrapesPerMonth;
  const savedPct = budget.scrapesPerMonthIfAllActive > 0
    ? Math.round((saved / budget.scrapesPerMonthIfAllActive) * 100)
    : 0;
  return (
    <div className="card p-4 mb-8 border-emerald-500/30">
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="font-bold text-sm">Scrape budget</h2>
        <span className="text-[10px] text-buzz-mute uppercase tracking-wider">
          dormant venues get a longer cooldown to save Apify cost
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Mini
          label="Active venues"
          value={budget.active}
          subtitle={`event in last 90 days · ${budget.activeScrapesPerMonth.toLocaleString()} scrapes/mo`}
        />
        <Mini
          label="Dormant venues"
          value={budget.dormant}
          subtitle={`scraped every 14 days · ${budget.dormantScrapesPerMonth.toLocaleString()} scrapes/mo`}
        />
        <Mini
          label="Scrapes/mo (now)"
          value={budget.totalScrapesPerMonth}
          subtitle="estimated, both tiers combined"
          accent
        />
        <Mini
          label="Saved vs. all-active"
          value={saved}
          subtitle={`${savedPct}% reduction · would be ${budget.scrapesPerMonthIfAllActive.toLocaleString()}/mo`}
          good
        />
      </div>
      {budget.neverScraped > 0 && (
        <p className="text-[11px] text-buzz-mute mt-3">
          ↳ <strong>{budget.neverScraped}</strong> venue
          {budget.neverScraped === 1 ? "" : "s"} have never been scraped — they&apos;ll
          go first on the next cron run regardless of dormancy.
        </p>
      )}
    </div>
  );
}

function Mini({
  label,
  value,
  subtitle,
  accent,
  good,
}: {
  label: string;
  value: number;
  subtitle: string;
  accent?: boolean;
  good?: boolean;
}) {
  const color = good ? "text-emerald-400" : accent ? "text-buzz-accent" : "text-buzz-text";
  return (
    <div>
      <div className={`text-xl font-bold tabular-nums leading-tight ${color}`}>
        {value.toLocaleString()}
      </div>
      <div className="text-[10px] text-buzz-mute uppercase tracking-wider mt-0.5">{label}</div>
      <div className="text-[10px] text-buzz-mute/70 mt-0.5 leading-snug">{subtitle}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-buzz-mute font-bold">{children}</th>;
}

function Td({ children, title }: { children: React.ReactNode; title?: string }) {
  return <td className="px-3 py-2" title={title}>{children}</td>;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
