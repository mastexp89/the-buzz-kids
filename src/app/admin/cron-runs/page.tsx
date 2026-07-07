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
      webVenuesScraped: acc.webVenuesScraped + d.webVenuesScraped,
      webEventsCreated: acc.webEventsCreated + d.webEventsCreated,
      fbVenuesScraped: acc.fbVenuesScraped + d.fbVenuesScraped,
      fbEventsCreated: acc.fbEventsCreated + d.fbEventsCreated,
      fbEventsSkipped: acc.fbEventsSkipped + d.fbEventsSkipped,
      fbErrors: acc.fbErrors + d.fbErrors,
      coverPhotosPopulated: acc.coverPhotosPopulated + d.coverPhotosPopulated,
      manualEventsCreated: acc.manualEventsCreated + d.manualEventsCreated,
      eventsRejected: acc.eventsRejected + d.eventsRejected,
    }),
    {
      webVenuesScraped: 0,
      webEventsCreated: 0,
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
        Daily output of the scheduled jobs. The <strong className="text-buzz-text">website scraper</strong> runs
        Tue + Sat at 9pm UK — small runs are normal, since each venue is only re-scraped every 30 days.
        The FB scraper (Mon + Thu evenings) is mostly idle by design; the dedupe pass runs daily at 3am UTC.
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
        <Stat label="Websites scraped (30d)" value={totals.webVenuesScraped} />
        <Stat label="Events from websites (30d)" value={totals.webEventsCreated} />
        <Stat label="Events from FB (30d)" value={totals.fbEventsCreated} />
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
              <Th>Website scrape</Th>
              <Th>Sites scraped</Th>
              <Th>New events</Th>
              <Th>FB</Th>
              <Th>Cover photos</Th>
              <Th>Manual events</Th>
              <Th>Rejected</Th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const isQuiet =
                d.webVenuesScraped === 0 &&
                d.webEventsCreated === 0 &&
                d.fbVenuesScraped === 0 &&
                d.fbEventsCreated === 0 &&
                d.coverPhotosPopulated === 0 &&
                d.manualEventsCreated === 0 &&
                d.eventsRejected === 0;
              const webRan = d.webVenuesScraped > 0 || d.webEventsCreated > 0;
              return (
                <tr key={d.date} className={`border-t border-buzz-border/60 ${isQuiet ? "text-buzz-mute" : ""}`}>
                  <Td>
                    <div className="font-medium">{d.weekday} {formatShortDate(d.date)}</div>
                    <div className="text-[10px] text-buzz-mute">{d.date}</div>
                  </Td>
                  <Td>
                    {webRan ? (
                      <span className="text-emerald-500 text-[10px] font-bold uppercase">✓ ran</span>
                    ) : d.webExpected ? (
                      <span
                        className="text-buzz-mute text-[10px] font-bold uppercase"
                        title="The cron fired but every venue was still inside its 30-day re-scrape cooldown — nothing due, nothing scraped. Normal."
                      >
                        quiet · on cooldown
                      </span>
                    ) : (
                      <span className="text-buzz-mute text-[10px]">—</span>
                    )}
                  </Td>
                  <Td>{d.webVenuesScraped > 0 ? d.webVenuesScraped : "—"}</Td>
                  <Td>{d.webEventsCreated > 0 ? <strong className="text-buzz-accent">{d.webEventsCreated}</strong> : "—"}</Td>
                  <Td
                    title={
                      "FB scraping is mostly idle by design (venue websites are the main source)." +
                      (d.fbEventsSkipped > 0 ? ` ${d.fbEventsSkipped} skipped as duplicates.` : "") +
                      (d.fbErrors > 0 ? ` ${d.fbErrors} errors — check fb_scrape_venue_runs.` : "")
                    }
                  >
                    {d.fbEventsCreated > 0 ? (
                      <strong className="text-buzz-accent">{d.fbEventsCreated}</strong>
                    ) : d.fbErrors > 0 ? (
                      <span className="text-rose-400 font-bold">{d.fbErrors} err</span>
                    ) : d.fbExpected ? (
                      <span className="text-buzz-mute text-[10px] uppercase">idle</span>
                    ) : (
                      "—"
                    )}
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
        Note: stats are derived from <code>events.created_at</code>, <code>venues.last_website_scrape</code> and{" "}
        <code>venues.last_facebook_scrape</code>. A "quiet · on cooldown" website day is normal — venues are only
        re-scraped every 30 days, so runs are small until a batch comes due. Check Vercel logs if a run that
        should have found work looks empty.
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
