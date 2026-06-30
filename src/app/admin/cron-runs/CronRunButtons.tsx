"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  runDedupeNow,
  runFacebookScrapeNow,
  runWebsiteScrapeNow,
  getFacebookCronProgress,
  getWebsiteCronProgress,
  type FacebookCronProgress,
  type WebsiteCronProgress,
} from "./actions";

type RunResult = { ok: true; body: string } | { error: string } | null;

type CityOption = { slug: string; name: string; active: boolean };

export default function CronRunButtons({ cities }: { cities: CityOption[] }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [running, setRunning] = useState<"dedupe" | "dedupe-dry" | "facebook" | "website" | "website-dry" | null>(null);
  const [result, setResult] = useState<RunResult>(null);
  // FB scrape city scope: "all" or a city slug. Default to all.
  const [fbScope, setFbScope] = useState<string>("all");
  // Website scrape scope + cooldown bypass (mirrors the FB controls).
  const [webScope, setWebScope] = useState<string>("all");
  const [webForce, setWebForce] = useState(false);
  // Bypass the 12h re-scrape cooldown — useful when admin wants to
  // re-run a sweep that already happened earlier today, e.g. to pick up
  // posts that landed since.
  const [fbForce, setFbForce] = useState(false);

  // Live FB scrape progress (polled while the sweep is running).
  const [fbProgress, setFbProgress] = useState<FacebookCronProgress | null>(null);
  const [fbPolling, setFbPolling] = useState(false);
  const [fbProgressScope, setFbProgressScope] = useState<string>("all");
  // Number of times we've auto-fired a continuation because the chain
  // appeared to stall. Capped to prevent infinite loops if something's
  // genuinely broken.
  const [autoRestarts, setAutoRestarts] = useState(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadlineRef = useRef<number>(0);
  const lastSeenRef = useRef<{ done: number; events: number; stableSince: number } | null>(null);
  const autoRestartsRef = useRef(0);
  const MAX_AUTO_RESTARTS = 8;

  // Live website scrape progress (the self-chaining sweep runs in the
  // background; this polls the DB-derived progress so the admin can watch it).
  const [webProgress, setWebProgress] = useState<WebsiteCronProgress | null>(null);
  const [webPolling, setWebPolling] = useState(false);
  const webTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const webDeadlineRef = useRef<number>(0);
  const webLastRef = useRef<{ done: number; events: number; stableSince: number } | null>(null);

  function stopWebPolling() {
    if (webTimerRef.current) { clearInterval(webTimerRef.current); webTimerRef.current = null; }
    setWebPolling(false);
  }

  // Poll every 5s for up to 90 minutes; stop once nothing has moved for 4
  // minutes (sweep finished or stalled — the chain self-continues, so no
  // auto-restart needed).
  function startWebPolling() {
    setWebPolling(true);
    webDeadlineRef.current = Date.now() + 90 * 60 * 1000;
    webLastRef.current = null;
    if (webTimerRef.current) clearInterval(webTimerRef.current);
    async function tick() {
      if (Date.now() > webDeadlineRef.current) { stopWebPolling(); return; }
      const res = await getWebsiteCronProgress();
      if ("error" in res) return;
      setWebProgress(res);
      const sig = { done: res.done, events: res.eventsCreatedToday };
      const last = webLastRef.current;
      if (last && last.done === sig.done && last.events === sig.events) {
        if (Date.now() - last.stableSince > 240_000) { stopWebPolling(); router.refresh(); }
      } else {
        webLastRef.current = { ...sig, stableSince: Date.now() };
      }
    }
    tick();
    webTimerRef.current = setInterval(tick, 5000);
  }

  function stopPolling() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setFbPolling(false);
  }

  // Poll the progress endpoint every 4s for up to 30 minutes (longer to
  // accommodate auto-restarts), stopping early when the sweep is genuinely
  // done. Polls with the same city scope as the run that started it.
  function startFbPolling(citySlugForScope: string) {
    setFbPolling(true);
    setFbProgressScope(citySlugForScope);
    pollDeadlineRef.current = Date.now() + 30 * 60 * 1000;
    lastSeenRef.current = null;
    autoRestartsRef.current = 0;
    setAutoRestarts(0);
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    async function tick() {
      if (Date.now() > pollDeadlineRef.current) {
        stopPolling();
        return;
      }
      const res = await getFacebookCronProgress(
        citySlugForScope === "all" ? {} : { citySlug: citySlugForScope },
      );
      if ("error" in res) {
        // Don't stop on a single error — could be a transient blip
        return;
      }
      setFbProgress(res);
      // Has anything moved?
      const sig = { done: res.done, events: res.eventsCreatedToday };
      const last = lastSeenRef.current;
      if (last && last.done === sig.done && last.events === sig.events) {
        if (Date.now() - last.stableSince > 90_000) {
          // 90s of no movement. Two cases:
          //   1. The sweep finished (done >= total) → stop polling, done.
          //   2. The chain broke mid-sweep (done < total) → auto-fire the
          //      cron again. Since the route orders venues by oldest scrape
          //      first, a re-trigger naturally picks up where it left off.
          const finished = res.done >= res.total;
          if (finished || autoRestartsRef.current >= MAX_AUTO_RESTARTS) {
            stopPolling();
            router.refresh();
          } else {
            // Self-heal: re-fire the same scope and reset the stable-since
            // timer so we keep watching the new sweep too.
            autoRestartsRef.current += 1;
            setAutoRestarts(autoRestartsRef.current);
            lastSeenRef.current = { ...sig, stableSince: Date.now() };
            runFacebookScrapeNow({
              ...(fbProgressScope === "all" ? {} : { citySlug: fbProgressScope }),
              ...(fbForce ? { force: true } : {}),
            }).catch(() => { /* swallow — next poll will surface state */ });
          }
        }
      } else {
        lastSeenRef.current = { ...sig, stableSince: Date.now() };
      }
    }

    tick(); // immediate
    pollTimerRef.current = setInterval(tick, 4000);
  }

  // Cleanup polls on unmount.
  useEffect(() => () => { stopPolling(); stopWebPolling(); }, []);

  function fire(label: "dedupe" | "dedupe-dry" | "facebook" | "website" | "website-dry") {
    setResult(null);
    setRunning(label);
    if (label === "facebook") {
      // Kick off polling immediately — even if the trigger call 504s,
      // the chain may already be running on Vercel and we want to show it.
      startFbPolling(fbScope);
    }
    if (label === "website") {
      // The self-chaining sweep keeps running in the background; start
      // watching its progress straight away.
      startWebPolling();
    }
    startTransition(async () => {
      let res: RunResult;
      if (label === "dedupe") res = await runDedupeNow({});
      else if (label === "dedupe-dry") res = await runDedupeNow({ dry: true });
      else if (label === "website" || label === "website-dry")
        res = await runWebsiteScrapeNow({
          ...(webScope === "all" ? {} : { citySlug: webScope }),
          ...(webForce ? { force: true } : {}),
          ...(label === "website-dry" ? { dry: true } : {}),
        });
      else
        res = await runFacebookScrapeNow({
          ...(fbScope === "all" ? {} : { citySlug: fbScope }),
          ...(fbForce ? { force: true } : {}),
        });
      setResult(res);
      setRunning(null);
      if (label !== "facebook" && label !== "website") router.refresh();
    });
  }

  return (
    <div className="card p-5 mb-8">
      <p className="eyebrow text-buzz-accent text-[10px]">Run on demand</p>
      <h2 className="font-display text-xl mb-2">Trigger a cron now</h2>
      <p className="text-buzz-mute text-xs mb-4 max-w-2xl">
        Admin-only. The schedules below run automatically; these buttons let you
        fire them off-schedule (handy after a big import session, when duplicates
        are still on the page).
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          type="button"
          onClick={() => fire("dedupe-dry")}
          disabled={busy}
          className="btn-secondary"
        >
          {running === "dedupe-dry" ? "Running…" : "🔍 Preview dedupe"}
        </button>
        <button
          type="button"
          onClick={() => fire("dedupe")}
          disabled={busy}
          className="btn-primary"
        >
          {running === "dedupe" ? "Running…" : "🧹 Run dedupe now"}
        </button>
      </div>

      {/* FB scrape with city scope picker */}
      <div className="border-t border-buzz-border/60 pt-3 mt-3">
        <label className="label">Facebook scrape — scope</label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input flex-1 min-w-[180px] py-1.5"
            value={fbScope}
            onChange={(e) => setFbScope(e.target.value)}
            disabled={busy}
          >
            <option value="all">All cities</option>
            {cities.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
                {c.active ? "" : " — hidden"}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => fire("facebook")}
            disabled={busy}
            className="btn-secondary"
          >
            {running === "facebook"
              ? "Started…"
              : fbScope === "all"
              ? "📘 Run FB scrape (all cities)"
              : `📘 Run FB scrape (${cities.find((c) => c.slug === fbScope)?.name ?? fbScope})`}
          </button>
        </div>
        <label className="flex items-center gap-2 mt-2 text-xs text-buzz-mute cursor-pointer select-none">
          <input
            type="checkbox"
            checked={fbForce}
            onChange={(e) => setFbForce(e.target.checked)}
            disabled={busy}
            className="accent-buzz-accent"
          />
          Force re-scrape (ignore 12h cooldown)
        </label>
        <p className="help mt-2">
          Scoping to a single city is handy after a bulk venue add — only the new
          region's venues get hit, you don't waste Apify credit re-scraping
          venues that were just done. Force is for when you want to re-run a
          sweep that already happened today (e.g. to pick up posts that landed since).
        </p>
      </div>

      {/* Website scrape — checks venues' own sites, queues events for review */}
      <div className="border-t border-buzz-border/60 pt-3 mt-3">
        <label className="label">Website scrape — scope</label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input flex-1 min-w-[180px] py-1.5"
            value={webScope}
            onChange={(e) => setWebScope(e.target.value)}
            disabled={busy}
          >
            <option value="all">All active cities</option>
            {cities.filter((c) => c.active).map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => fire("website-dry")}
            disabled={busy}
            className="btn-secondary"
          >
            {running === "website-dry" ? "Running…" : "🔍 Preview"}
          </button>
          <button
            type="button"
            onClick={() => fire("website")}
            disabled={busy}
            className="btn-secondary"
          >
            {running === "website"
              ? "Running…"
              : webScope === "all"
              ? "🌐 Scrape sites (all active)"
              : `🌐 Scrape sites (${cities.find((c) => c.slug === webScope)?.name ?? webScope})`}
          </button>
        </div>
        <label className="flex items-center gap-2 mt-2 text-xs text-buzz-mute cursor-pointer select-none">
          <input
            type="checkbox"
            checked={webForce}
            onChange={(e) => setWebForce(e.target.checked)}
            disabled={busy}
            className="accent-buzz-accent"
          />
          Force re-scrape (ignore 30-day cooldown)
        </label>
        <p className="help mt-2">
          Fetches each venue&apos;s own website, pulls out any kids&apos; events with AI, and
          drops them in the <Link href="/admin/queue" className="text-buzz-accent hover:underline">approval queue</Link> for you to vet.
          One click sweeps <strong>every</strong> eligible venue (it self-chains in the background — the button
          returns fast but the sweep keeps running). Progress shows below. Runs automatically Tue + Sat evenings.
        </p>

        {/* Live website scrape progress — the sweep runs in the background, so
            this polls the DB-derived progress while it works through venues. */}
        {(webPolling || webProgress) && (
          <div className="mt-4 rounded-lg border border-buzz-accent/30 bg-buzz-accent/5 p-3">
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <div className="text-sm font-medium flex items-center gap-2">
                {webPolling && <span className="inline-block w-2 h-2 rounded-full bg-rose-500 animate-pulse" />}
                {webPolling ? "Website scrape running…" : "Website scrape progress"}
              </div>
              {webPolling && (
                <button type="button" onClick={stopWebPolling} className="text-xs text-buzz-mute hover:text-buzz-accent">
                  Stop watching
                </button>
              )}
            </div>
            {webProgress && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-sm mb-2">
                  <div className="rounded bg-buzz-bg/50 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-buzz-mute">Venues covered</div>
                    <div className="font-display text-xl">
                      {webProgress.done}<span className="text-buzz-mute text-sm"> / {webProgress.total}</span>
                    </div>
                  </div>
                  <div className="rounded bg-buzz-bg/50 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-buzz-mute">Scanned today</div>
                    <div className="font-display text-xl">{webProgress.venuesScannedToday}</div>
                  </div>
                  <div className="rounded bg-buzz-bg/50 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-buzz-mute">Events queued today</div>
                    <div className="font-display text-xl text-emerald-400">{webProgress.eventsCreatedToday}</div>
                  </div>
                  <div className="rounded bg-buzz-bg/50 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-buzz-mute">Blocked / errored</div>
                    <div className="font-display text-xl text-amber-400">{webProgress.errorsToday}</div>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-buzz-bg/60 overflow-hidden mb-2">
                  <div className="h-full bg-buzz-accent transition-all" style={{ width: `${webProgress.pct}%` }} />
                </div>
                {webProgress.lastFive.length > 0 && (
                  <p className="text-xs text-buzz-mute truncate">
                    Latest:{" "}
                    {webProgress.lastFive.map((v) => `${v.name}${v.error ? " ✕" : v.events ? ` (+${v.events})` : ""}`).join(", ")}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Live FB scrape progress — shows while the sweep is running, even
          if the initial trigger call returned a 504. */}
      {(fbPolling || fbProgress) && (
        <div className="mt-4 rounded-lg border border-buzz-accent/30 bg-buzz-accent/5 p-3">
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <div className="text-sm font-medium flex items-center gap-2">
              {fbPolling && (
                <span className="inline-block w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
              )}
              {fbPolling ? "FB scrape running…" : "FB scrape progress (today)"}
              {fbProgressScope !== "all" && (
                <span className="text-xs font-normal text-buzz-mute">
                  · {cities.find((c) => c.slug === fbProgressScope)?.name ?? fbProgressScope}
                </span>
              )}
              {autoRestarts > 0 && (
                <span
                  className="text-xs font-normal text-buzz-accent"
                  title={`Chain stalled ${autoRestarts} time(s); auto-fired the cron again to keep going.`}
                >
                  · auto-resumed ×{autoRestarts}
                </span>
              )}
            </div>
            {fbPolling && (
              <button
                type="button"
                onClick={stopPolling}
                className="text-xs text-buzz-mute hover:text-buzz-accent"
              >
                Stop watching
              </button>
            )}
          </div>
          {fbProgress && (
            <>
              <div className="grid grid-cols-3 gap-2 text-center text-sm mb-2">
                <div className="rounded bg-buzz-bg/50 p-2">
                  <div className="text-[10px] uppercase tracking-wider text-buzz-mute">Venues scraped</div>
                  <div className="font-display text-xl">
                    {fbProgress.done}
                    <span className="text-buzz-mute text-sm"> / {fbProgress.total}</span>
                  </div>
                </div>
                <div className="rounded bg-buzz-bg/50 p-2">
                  <div className="text-[10px] uppercase tracking-wider text-buzz-mute">Events created</div>
                  <div className="font-display text-xl text-emerald-400">
                    {fbProgress.eventsCreatedToday}
                  </div>
                </div>
                <div className="rounded bg-buzz-bg/50 p-2">
                  <div className="text-[10px] uppercase tracking-wider text-buzz-mute">Cover photos</div>
                  <div className="font-display text-xl">
                    {fbProgress.coverPhotosPopulatedToday}
                  </div>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-buzz-bg/60 overflow-hidden mb-2">
                <div
                  className="h-full bg-buzz-accent transition-all"
                  style={{ width: `${fbProgress.pct}%` }}
                />
              </div>
              {fbProgress.lastFiveScraped.length > 0 && (
                <p className="text-xs text-buzz-mute truncate">
                  Last scraped: {fbProgress.lastFiveScraped.slice(0, 3).map((v) => v.name).join(", ")}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {result && "error" in result && (
        <pre className="text-xs text-rose-400 whitespace-pre-wrap break-all mt-3">
          {result.error}
        </pre>
      )}
      {result && "ok" in result && (
        <details className="text-xs mt-3">
          <summary className="cursor-pointer text-buzz-mute hover:text-buzz-accent">
            ✓ Done — view raw response
          </summary>
          <pre className="mt-2 p-3 rounded bg-buzz-bg/60 border border-buzz-border max-h-72 overflow-auto whitespace-pre-wrap break-all text-buzz-mute">
            {result.body.length > 8000 ? result.body.slice(0, 8000) + "\n…(truncated)" : result.body}
          </pre>
        </details>
      )}
      <p className="text-xs text-buzz-mute mt-3">
        FB scrape self-chains on Vercel — the response comes back fast but the
        full sweep keeps running in the background. Refresh the stats below in
        a few minutes to see the rolling tally.
      </p>
    </div>
  );
}
