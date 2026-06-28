"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  runExtraction,
  type RunExtractionResult,
  listWebsiteScrapeCandidates,
  listFacebookScrapeCandidates,
  listVenuesNeedingFacebookUrl,
  listEventsNeedingArtistBackfill,
  listUnclaimedArtists,
  extractFromWebsite,
  extractSocialsFromWebsite,
  extractFromFacebook,
  findFacebookUrlForVenue,
  findArtistSocials,
  backfillArtistsForEvent,
  type ScrapeOneResult,
} from "./actions";

type Venue = {
  id: string;
  name: string;
  slug: string;
  facebook: string | null;
  website: string | null;
  auto_imported: boolean | null;
  owner_id: string | null;
  city: { name: string; slug: string } | null;
};

type ExtractedEvent = {
  id?: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  recurring: { pattern: string; until: string | null } | null;
  type: string;
  genres: string[];
  description: string;
  confidence: number;
  evidence: string;
};

const SOURCES = [
  { value: "manual_upload", label: "Manual upload" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "website", label: "Website" },
  { value: "email", label: "Email" },
] as const;

export default function ExtractClient({ venues }: { venues: Venue[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunExtractionResult | null>(null);

  const [venueQuery, setVenueQuery] = useState("");
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);

  const [source, setSource] = useState<typeof SOURCES[number]["value"]>("manual_upload");
  const [sourceUrl, setSourceUrl] = useState("");
  const [textContent, setTextContent] = useState("");
  const [imageUrlsRaw, setImageUrlsRaw] = useState("");
  const [postedAt, setPostedAt] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });

  const filteredVenues = useMemo(() => {
    const q = venueQuery.trim().toLowerCase();
    if (!q) return venues.slice(0, 8);
    return venues
      .filter((v) =>
        v.name.toLowerCase().includes(q) ||
        (v.city?.name ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [venueQuery, venues]);

  function pickVenue(v: Venue) {
    setSelectedVenue(v);
    setVenueQuery(v.name);
    if (!sourceUrl) {
      if (source === "facebook" && v.facebook) setSourceUrl(v.facebook);
      else if (source === "website" && v.website) setSourceUrl(v.website);
    }
  }

  function clearVenue() {
    setSelectedVenue(null);
    setVenueQuery("");
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!selectedVenue) {
      setError("Pick a venue first.");
      return;
    }
    const imageUrls = imageUrlsRaw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!textContent.trim() && imageUrls.length === 0) {
      setError("Need text or at least one image URL.");
      return;
    }

    start(async () => {
      const r = await runExtraction({
        venueId: selectedVenue.id,
        source,
        sourceUrl: sourceUrl.trim() || null,
        textContent: textContent.trim() || null,
        imageUrls,
        postedAt: new Date(postedAt).toISOString(),
      });
      if ("error" in r) setError(r.error);
      else setResult(r);
    });
  }

  function reset() {
    setResult(null);
    setError(null);
    setTextContent("");
    setImageUrlsRaw("");
    setSourceUrl("");
  }

  return (
    <div className="grid gap-6">
      <BulkScrapePanel />

      <details className="card p-5">
        <summary className="cursor-pointer font-display text-xl">
          Manual extraction (paste a single post / page chunk)
        </summary>
        <div className="mt-5">
      <form onSubmit={onSubmit} className="grid sm:grid-cols-2 gap-4">
        {/* Venue picker */}
        <div className="sm:col-span-2">
          <label className="label">Venue *</label>
          {selectedVenue ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-buzz-accent/50 bg-buzz-accent/10 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate">{selectedVenue.name}</div>
                <div className="text-xs text-buzz-mute truncate">
                  {selectedVenue.city?.name ?? "—"}
                  {selectedVenue.owner_id ? " · Has owner" : " · Unclaimed (auto-approve)"}
                  {selectedVenue.facebook ? " · FB ✓" : ""}
                  {selectedVenue.website ? " · Site ✓" : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={clearVenue}
                className="text-sm text-buzz-mute hover:text-buzz-accent shrink-0"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                className="input"
                placeholder="Search venue name or city…"
                value={venueQuery}
                onChange={(e) => setVenueQuery(e.target.value)}
                autoComplete="off"
              />
              {venueQuery.trim().length > 0 && (
                <div className="mt-2 rounded-xl border border-buzz-border bg-buzz-card overflow-hidden">
                  {filteredVenues.length > 0 ? (
                    <ul className="divide-y divide-buzz-border">
                      {filteredVenues.map((v) => (
                        <li key={v.id}>
                          <button
                            type="button"
                            onClick={() => pickVenue(v)}
                            className="w-full text-left px-4 py-2 hover:bg-buzz-surface transition"
                          >
                            <div className="text-sm font-medium truncate">{v.name}</div>
                            <div className="text-xs text-buzz-mute truncate">
                              {v.city?.name ?? "—"}
                              {v.auto_imported ? " · Auto-imported" : ""}
                              {v.owner_id ? " · Owned" : ""}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="px-4 py-3 text-sm text-buzz-mute">
                      No venues match "{venueQuery}".
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <label className="label">Source</label>
          <select
            className="input"
            value={source}
            onChange={(e) => setSource(e.target.value as any)}
          >
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Posted at</label>
          <input
            className="input"
            type="datetime-local"
            value={postedAt}
            onChange={(e) => setPostedAt(e.target.value)}
            style={{ colorScheme: "dark" }}
          />
          <p className="help">
            Anchors relative dates ("tonight", "Sunday"). Defaults to right now.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className="label">Source URL (optional)</label>
          <input
            type="url"
            className="input"
            placeholder="https://www.facebook.com/taysquare/posts/…"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="label">Post text / page text</label>
          <textarea
            className="input min-h-[140px]"
            placeholder="Paste the FB post caption, or a chunk of the venue's What's On page text…"
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="label">Upload posters</label>
          <PosterFileUploader
            onUploaded={(urls) =>
              setImageUrlsRaw((prev) => {
                const existing = prev.trim();
                const next = urls.join("\n");
                return existing ? `${existing}\n${next}` : next;
              })
            }
          />
        </div>

        <div className="sm:col-span-2">
          <label className="label">Image URLs (one per line, or comma-separated)</label>
          <textarea
            className="input min-h-[80px] font-mono text-xs"
            placeholder="https://scontent.fdun1-1.fbcdn.net/...jpg"
            value={imageUrlsRaw}
            onChange={(e) => setImageUrlsRaw(e.target.value)}
          />
          <p className="help">
            Posters / FB post images. Claude reads these directly. Up to ~6 works well.
          </p>
        </div>

        {error && <div className="sm:col-span-2 text-sm text-rose-400">{error}</div>}

        <div className="sm:col-span-2 flex flex-wrap gap-3 items-center pt-1">
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "Extracting…" : "Extract events"}
          </button>
          {result && (
            <button type="button" className="btn-ghost" onClick={reset}>
              Clear
            </button>
          )}
          <span className="text-xs text-buzz-mute">
            ~$0.01–$0.03 per extraction.
          </span>
        </div>
      </form>

      {result && "ok" in result && (
        <div className="card p-5">
          <p className="eyebrow mb-1">Extracted</p>
          <h2 className="font-display text-2xl mb-1">
            {result.events.length} event{result.events.length === 1 ? "" : "s"} found
          </h2>
          <p className="text-xs text-buzz-mute mb-4">Batch {result.batchId}</p>

          {result.events.length === 0 ? (
            <p className="text-sm text-buzz-mute italic">
              Claude didn't find any extractable events in that input — probably not gig content.
            </p>
          ) : (
            <ul className="divide-y divide-buzz-border/60">
              {result.events.map((e, i) => (
                <li key={i} className="py-3">
                  <div className="flex items-start gap-3">
                    <ConfidencePill value={e.confidence} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{e.title}</div>
                      <div className="text-xs text-buzz-mute mt-0.5">
                        {new Date(e.starts_at).toLocaleString("en-GB", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {e.ends_at && (
                          <>
                            {" – "}
                            {new Date(e.ends_at).toLocaleTimeString("en-GB", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </>
                        )}
                        <span className="text-buzz-text/60"> · {e.type.replace("_", " ")}</span>
                        {e.recurring && (
                          <span className="text-buzz-accent"> · {e.recurring.pattern}</span>
                        )}
                      </div>
                      {e.description && (
                        <p className="text-sm mt-1 text-buzz-text/90">{e.description}</p>
                      )}
                      {e.genres && e.genres.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {e.genres.map((g) => (
                            <span
                              key={g}
                              className="text-[10px] uppercase tracking-wide bg-buzz-accent/15 text-buzz-accent border border-buzz-accent/30 rounded px-1.5 py-0.5"
                            >
                              {g}
                            </span>
                          ))}
                        </div>
                      )}
                      {e.evidence && (
                        <p className="text-[11px] text-buzz-mute italic mt-1">
                          Evidence: "{e.evidence}"
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {result.events.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/admin/queue" className="btn-secondary">
                View in approval queue →
              </Link>
              <span className="text-xs text-buzz-mute self-center">
                Events were created with status pending (or live if the venue has no owner).
              </span>
            </div>
          )}
        </div>
      )}
        </div>
      </details>
    </div>
  );
}

// --------- Bulk scrape panel: kicks off website + FB scrapes across all venues ---------

type LogLine = { kind: "ok" | "skip" | "err" | "info"; text: string };

function BulkScrapePanel() {
  const [running, setRunning] = useState<null | "website" | "facebook" | "find-fb" | "socials" | "backfill-artists" | "artist-socials">(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [log, setLog] = useState<LogLine[]>([]);
  const [stats, setStats] = useState({ scraped: 0, eventsCreated: 0, errors: 0 });
  const [apifyToken, setApifyToken] = useState("");
  const [apifyActor, setApifyActor] = useState("apify~facebook-posts-scraper");
  const [maxPostsPerVenue, setMaxPostsPerVenue] = useState(5);
  const [scrapeEvents, setScrapeEvents] = useState(true);
  const [scrapeSocials, setScrapeSocials] = useState(true);

  function pushLog(l: LogLine) {
    setLog((prev) => [...prev.slice(-300), l]);
  }

  async function runArtistSocials() {
    setRunning("artist-socials");
    setProgress({ done: 0, total: 0 });
    setLog([]);
    setStats({ scraped: 0, eventsCreated: 0, errors: 0 });

    pushLog({ kind: "info", text: "Loading unclaimed artists…" });
    const candidates = await listUnclaimedArtists();
    pushLog({ kind: "info", text: `Found ${candidates.length} unclaimed artists. Searching for FB / IG / Spotify / Bandcamp / Twitter / TikTok / YouTube.` });
    setProgress({ done: 0, total: candidates.length });

    let updated = 0;
    let totalUrls = 0;
    let errors = 0;

    for (const a of candidates) {
      try {
        const r = await findArtistSocials(a.id);
        if ("error" in r) {
          errors++;
          pushLog({ kind: "err", text: `[fail] ${a.name}: ${r.error}` });
          if (/Missing GOOGLE_CUSTOM_SEARCH/i.test(r.error)) break;
        } else if (r.newCount > 0) {
          updated++;
          totalUrls += r.newCount;
          const summary = Object.entries(r.foundUrls)
            .map(([k]) => k)
            .join(" · ");
          pushLog({ kind: "ok", text: `[ok]   ${a.name} (+${r.newCount}) ${summary}` });
        } else {
          pushLog({ kind: "skip", text: `[skip] ${a.name} — no matches` });
        }
      } catch (e: any) {
        errors++;
        pushLog({ kind: "err", text: `[crash] ${a.name}: ${e?.message ?? e}` });
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
      setStats({ scraped: updated, eventsCreated: totalUrls, errors });
    }

    pushLog({
      kind: "info",
      text: `Done. ${updated} artists got new socials, ${totalUrls} URLs total, ${errors} errors.`,
    });
    setRunning(null);
  }

  async function runArtistBackfill() {
    setRunning("backfill-artists");
    setProgress({ done: 0, total: 0 });
    setLog([]);
    setStats({ scraped: 0, eventsCreated: 0, errors: 0 });

    pushLog({ kind: "info", text: "Loading AI-extracted events with no artist links yet…" });
    const candidates = await listEventsNeedingArtistBackfill(2000);
    pushLog({ kind: "info", text: `Found ${candidates.length} events needing artist backfill.` });
    setProgress({ done: 0, total: candidates.length });

    let processed = 0;
    let totalArtistsLinked = 0;
    let errors = 0;

    for (const c of candidates) {
      try {
        const r = await backfillArtistsForEvent(c.id);
        if ("error" in r) {
          errors++;
          pushLog({ kind: "err", text: `[fail] ${c.title}: ${r.error}` });
        } else {
          processed++;
          totalArtistsLinked += r.artistsLinked;
          if (r.artistsLinked > 0) {
            pushLog({
              kind: "ok",
              text: `[ok]   ${c.title} (@ ${c.venue_name}) → ${r.artistNames.join(" · ")}`,
            });
          } else {
            pushLog({ kind: "skip", text: `[skip] ${c.title} (@ ${c.venue_name}) — no artists detected` });
          }
        }
      } catch (e: any) {
        errors++;
        pushLog({ kind: "err", text: `[crash] ${c.title}: ${e?.message ?? e}` });
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
      setStats({ scraped: processed, eventsCreated: totalArtistsLinked, errors });
    }

    pushLog({
      kind: "info",
      text: `Done. ${processed} events processed, ${totalArtistsLinked} artist links created, ${errors} errors.`,
    });
    setRunning(null);
  }

  async function runSocialsOnlyScrape() {
    setRunning("socials");
    setProgress({ done: 0, total: 0 });
    setLog([]);
    setStats({ scraped: 0, eventsCreated: 0, errors: 0 });

    pushLog({ kind: "info", text: "Loading venues with websites…" });
    const candidates = await listWebsiteScrapeCandidates();
    pushLog({ kind: "info", text: `Found ${candidates.length} venues with website set.` });
    setProgress({ done: 0, total: candidates.length });

    let scraped = 0;
    let socialsFound = 0;
    let errors = 0;

    for (const c of candidates) {
      try {
        const r = await extractSocialsFromWebsite(c.id);
        if ("error" in r) {
          errors++;
          pushLog({ kind: "err", text: `[fail] ${c.name}: ${r.error}` });
        } else {
          scraped++;
          socialsFound += r.socialsFound;
          pushLog({
            kind: r.socialsFound > 0 ? "ok" : "skip",
            text: `[${r.socialsFound > 0 ? "ok" : "..."}] ${c.name} — ${r.socialsFound} new social URL${r.socialsFound === 1 ? "" : "s"}`,
          });
        }
      } catch (e: any) {
        errors++;
        pushLog({ kind: "err", text: `[crash] ${c.name}: ${e?.message ?? e}` });
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
      setStats({ scraped, eventsCreated: socialsFound, errors });
    }

    pushLog({
      kind: "info",
      text: `Done. ${scraped} venues scanned, ${socialsFound} social URLs filled, ${errors} errors.`,
    });
    setRunning(null);
  }

  async function runFindFbUrls() {
    setRunning("find-fb");
    setProgress({ done: 0, total: 0 });
    setLog([]);
    setStats({ scraped: 0, eventsCreated: 0, errors: 0 });

    pushLog({ kind: "info", text: "Loading venues…" });
    const candidates = await listVenuesNeedingFacebookUrl();
    pushLog({
      kind: "info",
      text: `Scanning ${candidates.length} venues for FB / IG / Twitter / TikTok URLs (skips platforms already filled).`,
    });
    setProgress({ done: 0, total: candidates.length });

    let venuesUpdated = 0;
    let totalSocials = 0;
    let errors = 0;

    for (const c of candidates) {
      try {
        const r = await findFacebookUrlForVenue(c.id);
        if ("error" in r) {
          errors++;
          pushLog({ kind: "err", text: `[fail] ${c.name}: ${r.error}` });
          if (/Missing GOOGLE_CUSTOM_SEARCH/i.test(r.error)) break;
        } else if (r.newCount > 0) {
          venuesUpdated++;
          totalSocials += r.newCount;
          const summary = Object.entries(r.foundUrls)
            .map(([k, v]) => `${k}=${(v as string).replace(/^https?:\/\/(?:www\.)?/, "")}`)
            .join(" · ");
          pushLog({
            kind: "ok",
            text: `[ok]   ${c.name} (+${r.newCount}) ${summary}`,
          });
        } else {
          pushLog({ kind: "skip", text: `[skip] ${c.name} — nothing new` });
        }
      } catch (e: any) {
        errors++;
        pushLog({ kind: "err", text: `[crash] ${c.name}: ${e?.message ?? e}` });
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
      setStats({ scraped: venuesUpdated, eventsCreated: totalSocials, errors });
    }

    pushLog({
      kind: "info",
      text: `Done. ${venuesUpdated} venues got new socials, ${totalSocials} URLs total, ${errors} errors.`,
    });
    setRunning(null);
  }

  async function runWebsiteScrape() {
    setRunning("website");
    setProgress({ done: 0, total: 0 });
    setLog([]);
    setStats({ scraped: 0, eventsCreated: 0, errors: 0 });

    pushLog({ kind: "info", text: "Loading venues with websites…" });
    const candidates = await listWebsiteScrapeCandidates();
    pushLog({ kind: "info", text: `Found ${candidates.length} venues with website set.` });
    setProgress({ done: 0, total: candidates.length });

    let scraped = 0;
    let eventsCreated = 0;
    let errors = 0;

    for (const c of candidates) {
      try {
        const r = await extractFromWebsite(c.id);
        if ("error" in r) {
          errors++;
          pushLog({ kind: "err", text: `[fail] ${c.name}: ${r.error}` });
        } else {
          scraped++;
          eventsCreated += r.eventsCreated;
          pushLog({
            kind: r.eventsCreated > 0 ? "ok" : "skip",
            text: `[${r.eventsCreated > 0 ? "ok" : "..."}] ${c.name} — ${r.eventsCreated} event${
              r.eventsCreated === 1 ? "" : "s"
            } from ${r.pagesScraped ?? 0} page${r.pagesScraped === 1 ? "" : "s"}`,
          });
        }
      } catch (e: any) {
        errors++;
        pushLog({ kind: "err", text: `[crash] ${c.name}: ${e?.message ?? e}` });
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
      setStats({ scraped, eventsCreated, errors });
    }

    pushLog({
      kind: "info",
      text: `Done. ${scraped} scraped, ${eventsCreated} events created, ${errors} errors.`,
    });
    setRunning(null);
  }

  async function runFacebookScrape() {
    if (!apifyToken.trim()) {
      pushLog({ kind: "err", text: "Paste your Apify token first." });
      return;
    }
    setRunning("facebook");
    setProgress({ done: 0, total: 0 });
    setLog([]);
    setStats({ scraped: 0, eventsCreated: 0, errors: 0 });

    pushLog({ kind: "info", text: "Loading venues with Facebook URLs…" });
    const candidates = await listFacebookScrapeCandidates();
    pushLog({
      kind: "info",
      text: `Found ${candidates.length} venues with Facebook set. ~${
        Math.ceil((candidates.length * 8) / 60)
      } min total at ~5s per venue.`,
    });
    setProgress({ done: 0, total: candidates.length });

    let scraped = 0;
    let eventsCreated = 0;
    let errors = 0;

    for (const c of candidates) {
      try {
        const r = await extractFromFacebook({
          venueId: c.id,
          apifyToken: apifyToken.trim(),
          actorId: apifyActor.trim() || undefined,
          maxPosts: maxPostsPerVenue,
        });
        if ("error" in r) {
          errors++;
          pushLog({ kind: "err", text: `[fail] ${c.name}: ${r.error}` });
        } else {
          scraped++;
          eventsCreated += r.eventsCreated;
          pushLog({
            kind: r.eventsCreated > 0 ? "ok" : "skip",
            text: `[${r.eventsCreated > 0 ? "ok" : "..."}] ${c.name} — ${r.eventsCreated} event${
              r.eventsCreated === 1 ? "" : "s"
            } from ${r.postsScraped ?? 0} post${r.postsScraped === 1 ? "" : "s"}`,
          });
        }
      } catch (e: any) {
        errors++;
        pushLog({ kind: "err", text: `[crash] ${c.name}: ${e?.message ?? e}` });
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
      setStats({ scraped, eventsCreated, errors });
    }

    pushLog({
      kind: "info",
      text: `Done. ${scraped} scraped, ${eventsCreated} events created, ${errors} errors.`,
    });
    setRunning(null);
  }

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="card p-5">
      <p className="eyebrow mb-1">Bulk scrape</p>
      <h2 className="font-display text-2xl mb-3">Pull events from websites + Facebook</h2>
      <p className="text-buzz-mute text-sm mb-5 max-w-2xl">
        For each venue with a website / Facebook URL on file, fetch recent content,
        run it through Claude vision, and drop extracted gigs into the pending queue
        (or auto-publish if the venue has no owner). Skipped venues = no event content found.
      </p>

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-buzz-border p-4">
          <div className="font-semibold mb-1">🌐 Websites</div>
          <div className="text-xs text-buzz-mute mb-3">
            Fetches homepage + common subpages (/events, /whats-on, /gigs, /live-music).
          </div>
          <div className="flex flex-col gap-2 mb-3">
            <button
              type="button"
              onClick={runWebsiteScrape}
              disabled={running !== null}
              className="btn-primary w-full text-sm"
              title="Pulls events via AI + saves any social URLs found"
            >
              {running === "website" ? "Running…" : "Full scrape (events + socials)"}
            </button>
            <button
              type="button"
              onClick={runSocialsOnlyScrape}
              disabled={running !== null}
              className="btn-secondary w-full text-sm"
              title="Just pull FB / Insta / Twitter URLs from each venue website. No AI cost."
            >
              {running === "socials" ? "Running…" : "Socials only (free, fast)"}
            </button>
          </div>
          <div className="text-[11px] text-buzz-mute leading-snug">
            <strong>Full scrape</strong>: AI extracts events from page text + posters (~$0.02/venue, ~10s each).<br />
            <strong>Socials only</strong>: just FB / Insta / Twitter URLs. Free. ~1s per venue.
          </div>
        </div>

        <div className="rounded-xl border border-buzz-border p-4">
          <div className="font-semibold mb-1">🔍 Find social URLs</div>
          <div className="text-xs text-buzz-mute mb-3">
            For each venue, Googles "&lt;venue&gt; Dundee &lt;platform&gt;" for FB, Instagram, Twitter/X and TikTok. Skips platforms already set. Run this <strong>before</strong> the FB scraper. Free 100/day, then ~$0.005 per search.{" "}
            <Link
              href="https://programmablesearchengine.google.com"
              target="_blank"
              className="underline hover:text-buzz-accent"
            >
              Setup guide →
            </Link>
          </div>
          <button
            type="button"
            onClick={runFindFbUrls}
            disabled={running !== null}
            className="btn-primary w-full"
          >
            {running === "find-fb" ? "Running…" : "Find social URLs"}
          </button>
        </div>

        <div className="rounded-xl border border-buzz-border p-4 sm:col-span-3">
          <div className="font-semibold mb-1">🎤 Artist tools</div>
          <div className="text-xs text-buzz-mute mb-3">
            Two passes. Run them in order on existing events to populate the Artists page.
          </div>
          <div className="flex flex-col sm:flex-row gap-2 mb-2">
            <button
              type="button"
              onClick={runArtistBackfill}
              disabled={running !== null}
              className="btn-secondary text-sm flex-1"
              title="Pull artist names out of event titles + descriptions via Claude"
            >
              {running === "backfill-artists" ? "Running…" : "1. Backfill artists from event titles"}
            </button>
            <button
              type="button"
              onClick={runArtistSocials}
              disabled={running !== null}
              className="btn-secondary text-sm flex-1"
              title="For each unclaimed artist, find their FB / IG / Spotify / Bandcamp / TikTok / YouTube via Custom Search"
            >
              {running === "artist-socials" ? "Running…" : "2. Find socials for unclaimed artists"}
            </button>
          </div>
          <div className="text-[11px] text-buzz-mute leading-snug">
            <strong>Backfill:</strong> ~$0.005 per event via Claude. Auto-creates artist pages.<br />
            <strong>Find socials:</strong> Free 100/day via Google Custom Search, then ~$0.005 per artist. Skips claimed artists (their owner fills in their own).
          </div>
        </div>

        <div className="rounded-xl border border-buzz-border p-4">
          <div className="font-semibold mb-1">📘 Facebook (via Apify)</div>
          <div className="text-xs text-buzz-mute mb-3">
            Calls Apify's Facebook Posts Scraper actor. $5 per 1,000 posts ≈ $5 per full run across all venues.{" "}
            <Link
              href="https://console.apify.com/account/integrations"
              target="_blank"
              className="underline hover:text-buzz-accent"
            >
              Get a token →
            </Link>
          </div>
          <div className="grid gap-2 mb-3">
            <input
              type="password"
              className="input text-sm"
              placeholder="Apify token (apify_api_…)"
              value={apifyToken}
              onChange={(e) => setApifyToken(e.target.value)}
            />
            <input
              type="text"
              className="input text-sm font-mono"
              placeholder="Actor ID"
              value={apifyActor}
              onChange={(e) => setApifyActor(e.target.value)}
            />
            <div className="flex items-center gap-2 text-xs">
              <span className="text-buzz-mute">Max posts/venue:</span>
              <input
                type="number"
                min={1}
                max={20}
                className="input text-sm w-20 py-1"
                value={maxPostsPerVenue}
                onChange={(e) => setMaxPostsPerVenue(Math.max(1, Math.min(20, Number(e.target.value) || 5)))}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={runFacebookScrape}
            disabled={running !== null || !apifyToken}
            className="btn-primary w-full"
          >
            {running === "facebook" ? "Running…" : "Scrape all Facebook"}
          </button>
        </div>
      </div>

      {(running || progress.total > 0 || log.length > 0) && (
        <div className="mt-5">
          {progress.total > 0 && (
            <>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-buzz-mute">
                  {progress.done} / {progress.total} venues
                </span>
                <span className="text-buzz-mute">
                  {stats.scraped} ok · {stats.eventsCreated} events · {stats.errors} errors
                </span>
              </div>
              <div className="h-2 bg-buzz-border rounded overflow-hidden mb-3">
                <div className="h-full bg-buzz-accent transition-all" style={{ width: `${pct}%` }} />
              </div>
            </>
          )}
          <div className="bg-buzz-bg border border-buzz-border rounded-lg p-3 max-h-72 overflow-y-auto font-mono text-xs whitespace-pre-wrap">
            {log.map((l, i) => (
              <div
                key={i}
                className={
                  l.kind === "ok"
                    ? "text-emerald-400"
                    : l.kind === "err"
                    ? "text-rose-400"
                    : l.kind === "skip"
                    ? "text-buzz-mute"
                    : "text-buzz-text/80"
                }
              >
                {l.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ConfidencePill({ value }: { value: number }) {
  const cls =
    value >= 0.85
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
      : value >= 0.65
      ? "bg-amber-500/15 text-amber-400 border-amber-500/40"
      : "bg-rose-500/15 text-rose-400 border-rose-500/40";
  return (
    <span
      className={`shrink-0 text-[10px] uppercase tracking-wide font-semibold border rounded px-1.5 py-0.5 ${cls}`}
    >
      {(value * 100).toFixed(0)}%
    </span>
  );
}


function PosterFileUploader({ onUploaded }: { onUploaded: (urls: string[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const list = Array.from(files);
      const uploaded: string[] = [];
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        setProgress(`Uploading ${i + 1} of ${list.length}…`);
        const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
        const path = `events/${user.id}/${Date.now()}-${i}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("media")
          .upload(path, f, { upsert: false, contentType: f.type || "image/jpeg" });
        if (upErr) throw upErr;
        const { data } = supabase.storage.from("media").getPublicUrl(path);
        uploaded.push(data.publicUrl);
      }
      onUploaded(uploaded);
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        type="file"
        accept="image/*"
        multiple
        disabled={busy}
        onChange={(e) => handleFiles(e.target.files)}
        className="block text-sm text-buzz-mute file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-buzz-surface file:text-buzz-text hover:file:bg-buzz-card cursor-pointer"
      />
      {progress && <div className="text-xs text-buzz-accent">{progress}</div>}
      {error && <div className="text-xs text-rose-400">{error}</div>}
      <p className="help">Upload directly — no need to host them anywhere first. URLs are added to the box below automatically.</p>
    </div>
  );
}
