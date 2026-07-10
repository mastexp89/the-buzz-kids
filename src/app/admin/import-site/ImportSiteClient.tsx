"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { importEventsFromSiteUrl, type PlaceDraft } from "./actions";
import QuickImportReview, {
  resolveVenueFromHint,
  type Row,
} from "@/components/QuickImportReview";
import type { ChipArtist } from "@/components/ArtistChipPicker";

type Phase = "idle" | "uploading" | "fetching" | "reviewing";

const MAX_SCREENSHOTS = 8;

export default function ImportSiteClient() {
  const [url, setUrl] = useState("");
  const [screenshotUrls, setScreenshotUrls] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [stats, setStats] = useState<{ pagesFetched: number; pagesSkipped: number; total: number } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [places, setPlaces] = useState<PlaceDraft[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleScreenshots(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files).slice(0, MAX_SCREENSHOTS - screenshotUrls.length);
    if (list.length === 0) {
      setError(`Maximum ${MAX_SCREENSHOTS} screenshots per import.`);
      return;
    }
    setError(null);
    setPhase("uploading");
    setProgress(`Uploading ${list.length} screenshot${list.length === 1 ? "" : "s"}…`);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("Not signed in.");
      setPhase("idle");
      return;
    }
    const newUrls: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      if (!file.type.startsWith("image/")) {
        setError(`${file.name} isn't an image.`);
        setPhase("idle");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setError(`${file.name} is over 10MB.`);
        setPhase("idle");
        return;
      }
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `events/${user.id}/site-screenshot-${Date.now()}-${i}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("media")
        .upload(path, file, { upsert: false, contentType: file.type || "image/jpeg" });
      if (upErr) {
        setError(`Upload failed: ${upErr.message}`);
        setPhase("idle");
        return;
      }
      const { data } = supabase.storage.from("media").getPublicUrl(path);
      newUrls.push(data.publicUrl);
    }
    setScreenshotUrls((prev) => [...prev, ...newUrls]);
    setPhase("idle");
    setProgress(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function removeScreenshot(idx: number) {
    setScreenshotUrls((prev) => prev.filter((_, i) => i !== idx));
  }

  async function runImport() {
    // Treat each non-empty line as its own URL. Single-URL → discovery mode;
    // multi-URL → each line is fetched directly as a detail page.
    const urls = url
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const hasUrls = urls.length > 0;
    const hasScreenshots = screenshotUrls.length > 0;
    if (!hasUrls && !hasScreenshots) {
      setError("Paste a URL or upload at least one screenshot.");
      return;
    }
    setError(null);
    setWarnings([]);
    setPhase("fetching");

    let result;
    if (hasScreenshots) {
      setProgress(`Reading ${screenshotUrls.length} screenshot${screenshotUrls.length === 1 ? "" : "s"}…`);
      result = await importEventsFromSiteUrl({ imageUrls: screenshotUrls });
    } else {
      setProgress(
        urls.length === 1
          ? "Fetching the page and pulling event links…"
          : `Fetching ${urls.length} event pages…`,
      );
      result = await importEventsFromSiteUrl(urls.length === 1 ? { url: urls[0] } : { urls });
    }
    if ("error" in result) {
      setError(result.error);
      setPhase("idle");
      return;
    }

    setProgress("Resolving venues for each gig…");
    const newRows: Row[] = [];
    for (let i = 0; i < result.drafts.length; i++) {
      const d = result.drafts[i];
      // Server pre-matches artist names to existing rows; respect the match
      // so the chip renders as confirmed-existing instead of "(new)".
      const artistChips: ChipArtist[] = d.artists.map((a) =>
        a.matchedArtistId
          ? { kind: "existing" as const, id: a.matchedArtistId, name: a.name }
          : { kind: "new" as const, name: a.name },
      );
      const venue = await resolveVenueFromHint(d.venue_hint);
      newRows.push({
        key: `site-${i}-${Date.now()}`,
        posterImageUrl: d.posterImageUrl,
        draft: d,
        venue,
        artists: artistChips,
        state: "idle",
      });
    }

    const foundPlaces = result.places ?? [];
    setRows(newRows);
    setPlaces(foundPlaces);
    setStats({
      pagesFetched: result.pagesFetched,
      pagesSkipped: result.pagesSkipped,
      total: result.drafts.length,
    });
    setWarnings(result.warnings);
    setProgress(null);
    // Show the review screen if we found events OR places (a listings page
    // might be all attractions and no dated events).
    const hasSomething = newRows.length > 0 || foundPlaces.length > 0;
    setPhase(hasSomething ? "reviewing" : "idle");
    if (!hasSomething) {
      setError("Couldn't find any events or places on that page. Make sure the URL points to a listings / what's-on page.");
    }
  }

  function reset() {
    setRows([]);
    setPlaces([]);
    setStats(null);
    setWarnings([]);
    setError(null);
    setUrl("");
    setScreenshotUrls([]);
    setPhase("idle");
  }

  if (phase === "reviewing") {
    const inputUrls = url.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const fromScreenshots = screenshotUrls.length > 0;
    return (
      <div className="flex flex-col gap-4">
        <div className="card p-4">
          <p className="eyebrow mb-1">Imported from</p>
          {fromScreenshots ? (
            <div className="text-sm font-medium">
              {screenshotUrls.length} screenshot{screenshotUrls.length === 1 ? "" : "s"}
            </div>
          ) : inputUrls.length === 1 ? (
            <div className="text-sm font-medium truncate">{inputUrls[0]}</div>
          ) : (
            <div className="text-sm font-medium">{inputUrls.length} URLs pasted</div>
          )}
          {stats && (
            <p className="text-xs text-buzz-mute mt-2">
              {fromScreenshots ? "Read" : "Fetched"} {stats.pagesFetched} {fromScreenshots ? "image" : "page"}{stats.pagesFetched === 1 ? "" : "s"}
              {stats.pagesSkipped > 0 && <>, skipped {stats.pagesSkipped}</>} · {stats.total} event{stats.total === 1 ? "" : "s"}
              {places.length > 0 && <> · {places.length} place{places.length === 1 ? "" : "s"}</>} found
            </p>
          )}
          {warnings.length > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-buzz-mute cursor-pointer hover:text-buzz-accent">
                {warnings.length} warning{warnings.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-2 text-[11px] text-buzz-mute space-y-1 list-disc pl-4">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          )}
        </div>
        {places.length > 0 && (
          <div className="card p-4">
            <p className="eyebrow mb-1">Places found ({places.length})</p>
            <p className="text-xs text-buzz-mute mb-3">
              These look like attractions or venues, not dated events. Add the good ones to your Places directory.
            </p>
            <div className="flex flex-col gap-2">
              {places.map((p, i) => (
                <div key={i} className="rounded-lg border border-buzz-border bg-buzz-card p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {p.name}
                      {p.location ? <span className="text-buzz-mute font-normal"> · {p.location}</span> : null}
                    </div>
                    {p.description && <p className="text-xs text-buzz-mute mt-0.5 line-clamp-2">{p.description}</p>}
                    <a href={p.sourceUrl} target="_blank" rel="noopener" className="text-[11px] text-buzz-accent hover:underline">
                      view source ↗
                    </a>
                  </div>
                  <div className="shrink-0">
                    {p.alreadyExists ? (
                      <span className="text-[11px] text-buzz-mute rounded-full bg-buzz-bg border border-buzz-border px-2 py-1">
                        Already listed
                      </span>
                    ) : (
                      <a
                        href={`/admin/venues/new?name=${encodeURIComponent(p.name)}${p.website ? `&website=${encodeURIComponent(p.website)}` : ""}`}
                        target="_blank"
                        rel="noopener"
                        className="btn-secondary text-xs whitespace-nowrap"
                      >
                        Add as venue →
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {rows.length > 0 ? (
          <QuickImportReview initialRows={rows} onReset={reset} resetLabel="Cancel" />
        ) : (
          <div className="flex justify-end">
            <button onClick={reset} className="btn-secondary">Done</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card p-6">
      <h3 className="h-display text-2xl mb-2">🔗 Paste a URL</h3>
      <p className="text-buzz-mute text-sm mb-5 max-w-xl">
        Works for promoter sites, comedy clubs, ticket aggregators — anywhere
        a single page lists upcoming gigs at multiple venues. Each event will
        be extracted with the venue it's at, then you map to the right venue.
      </p>
      <div className="flex flex-col gap-3">
        <textarea
          className="input min-h-[88px] font-mono text-sm"
          placeholder={`https://example.com/upcoming-events\n\n— or paste individual event URLs, one per line —\n\nhttps://example.com/event/foo\nhttps://example.com/event/bar`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={phase === "fetching" || phase === "uploading"}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runImport();
          }}
        />

        <div className="flex items-center gap-2 text-buzz-mute text-xs">
          <span className="flex-1 h-px bg-buzz-border" />
          <span>or</span>
          <span className="flex-1 h-px bg-buzz-border" />
        </div>

        <div className="rounded-lg border border-dashed border-buzz-border p-3 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <div>
              <div className="text-sm font-medium">📸 Upload screenshot(s)</div>
              <div className="text-[11px] text-buzz-mute">
                For sites that block scraping (gov.uk / Cloudflare). Take a screenshot
                of the events page, drop it in, and Claude reads the events off it.
                Up to {MAX_SCREENSHOTS} per import.
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleScreenshots(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={phase === "uploading" || phase === "fetching" || screenshotUrls.length >= MAX_SCREENSHOTS}
              className="btn-secondary shrink-0 text-xs"
            >
              {phase === "uploading" ? "Uploading…" : screenshotUrls.length === 0 ? "Choose files" : "Add more"}
            </button>
          </div>

          {screenshotUrls.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {screenshotUrls.map((u, i) => (
                <div key={u} className="relative group">
                  <div
                    className="aspect-video rounded bg-buzz-surface border border-buzz-border"
                    style={{
                      backgroundImage: `url(${u})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => removeScreenshot(i)}
                    className="absolute top-1 right-1 bg-rose-500/90 text-white rounded-full w-5 h-5 grid place-items-center text-xs hover:bg-rose-600"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={runImport}
            disabled={phase === "fetching" || phase === "uploading"}
            className="btn-primary"
          >
            {phase === "fetching" ? "Working…" : "Import"}
          </button>
        </div>
      </div>
      {progress && <div className="text-xs text-buzz-accent mt-3">{progress}</div>}
      {error && <div className="text-sm text-rose-400 mt-3">{error}</div>}
      <div className="text-[11px] text-buzz-mute mt-4 space-y-1">
        <p>
          <strong>One URL</strong> → we scrape the listing page, follow every
          page of it, and pull each event's detail page. Works on tourism
          &ldquo;what&apos;s on&rdquo; portals — paste a category feed like{" "}
          <code>/whats-on-category/children-family/</code> (or music, outdoors,
          festivals…) and we&apos;ll keep the family-suitable events, drop the
          adult ones, and list any <strong>places</strong> separately to add.
        </p>
        <p>
          <strong>Multiple URLs</strong> (one per line) → we fetch each as an
          event detail page directly. Use for JS-rendered sites. ⌘/Ctrl+Enter to submit.
        </p>
        <p>
          <strong>Screenshot mode</strong> → bypass URL fetching entirely. Best
          for sites that block server requests. No per-event poster gets pulled
          (you can add them per-row before publishing).
        </p>
      </div>
    </div>
  );
}
