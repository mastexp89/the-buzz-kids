"use client";

import { useState, useTransition } from "react";
import {
  previewArtistImage,
  applyArtistImage,
  saveArtistFacebookUrl,
  findArtistFacebookUrl,
} from "./actions";

// Preview-then-confirm UI for bulk artist photo pulls. Each row starts
// idle, transitions to "previewing" while we fetch the FB og:image, then
// shows the candidate next to the current image with Use/Skip buttons.
//
// "Pull all" walks the visible artists serially (rate-limited to be
// polite to FB) and shows each preview as it comes in. Admin can still
// approve / skip per row before any DB writes happen.

type Artist = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  facebookUrl: string | null;
  websiteUrl: string | null;
};

type RowState =
  | { status: "idle" }
  | { status: "previewing" }
  | { status: "preview"; imageUrl: string; sourceUrl: string }
  | { status: "applying"; imageUrl: string }
  | { status: "applied"; imageUrl: string }
  | { status: "skipped" }
  | { status: "error"; message: string };

export default function ArtistPhotosClient({
  artists,
  mode = "pull-pic",
}: {
  artists: Artist[];
  // "pull-pic" — default; artists have FB URLs, we fetch og:image
  // "find-fb"  — artists DON'T have FB URLs yet; admin Googles + pastes
  mode?: "pull-pic" | "find-fb";
}) {
  // Switch to the find-FB-URL UI when admin's on the no-fb filter.
  if (mode === "find-fb") {
    return <FindFbUrlList artists={artists} />;
  }

  const [states, setStates] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(artists.map((a) => [a.id, { status: "idle" }])),
  );
  const [bulkRunning, setBulkRunning] = useState(false);
  const [pending, startTransition] = useTransition();

  function setRow(id: string, s: RowState) {
    setStates((prev) => ({ ...prev, [id]: s }));
  }

  async function preview(id: string) {
    setRow(id, { status: "previewing" });
    const r = await previewArtistImage(id);
    if ("error" in r) {
      setRow(id, { status: "error", message: r.error });
    } else {
      setRow(id, { status: "preview", imageUrl: r.imageUrl, sourceUrl: r.sourceUrl });
    }
  }

  async function apply(id: string, imageUrl: string) {
    setRow(id, { status: "applying", imageUrl });
    const r = await applyArtistImage(id, imageUrl);
    if ("error" in r) {
      setRow(id, { status: "error", message: r.error });
    } else {
      setRow(id, { status: "applied", imageUrl });
    }
  }

  async function runBulk() {
    if (bulkRunning) return;
    setBulkRunning(true);
    // Only process rows still idle (skip already-previewed / applied / errored)
    for (const a of artists) {
      const s = states[a.id];
      if (s?.status !== "idle") continue;
      await preview(a.id);
      // Polite delay so FB doesn't IP-block us
      await new Promise((r) => setTimeout(r, 800));
    }
    setBulkRunning(false);
  }

  const idleCount = Object.values(states).filter((s) => s.status === "idle").length;

  if (artists.length === 0) {
    return (
      <div className="card p-10 text-center text-buzz-mute">
        No artists matching this filter. Try the &quot;All with a Facebook URL&quot; toggle above.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="card p-3 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-buzz-mute">
          {artists.length} artist{artists.length === 1 ? "" : "s"} in this view · {idleCount} unpreviewed
        </p>
        <button
          type="button"
          onClick={() => startTransition(runBulk)}
          disabled={bulkRunning || idleCount === 0 || pending}
          className="btn-secondary text-sm"
        >
          {bulkRunning ? "Pulling…" : `🚀 Pull all (${idleCount})`}
        </button>
      </div>

      <ul className="card divide-y divide-buzz-border/60">
        {artists.map((a) => {
          const s = states[a.id] ?? { status: "idle" };
          return (
            <li key={a.id} className="p-4 flex gap-4 items-start">
              {/* Current */}
              <div className="shrink-0">
                <div className="text-[10px] uppercase tracking-wider text-buzz-mute mb-1">Current</div>
                <div className="w-20 h-20 rounded-lg bg-buzz-surface border border-buzz-border overflow-hidden grid place-items-center">
                  {a.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.imageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl text-buzz-mute">🎤</span>
                  )}
                </div>
              </div>

              {/* Middle: name + state */}
              <div className="flex-1 min-w-0 flex flex-col gap-2">
                <div>
                  <a
                    href={`/artists/${a.slug}`}
                    target="_blank"
                    rel="noopener"
                    className="font-medium hover:text-buzz-accent truncate block"
                  >
                    {a.name}
                  </a>
                  {a.facebookUrl && (
                    <a
                      href={a.facebookUrl}
                      target="_blank"
                      rel="noopener"
                      className="text-xs text-buzz-mute hover:text-buzz-accent truncate block font-mono"
                    >
                      {a.facebookUrl}
                    </a>
                  )}
                </div>

                {s.status === "idle" && (
                  <button
                    type="button"
                    onClick={() => preview(a.id)}
                    className="btn-secondary text-xs self-start"
                  >
                    Pull pic
                  </button>
                )}

                {s.status === "previewing" && (
                  <span className="text-xs text-buzz-mute italic">Fetching og:image…</span>
                )}

                {s.status === "applying" && (
                  <span className="text-xs text-buzz-mute italic">Saving…</span>
                )}

                {s.status === "preview" && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => apply(a.id, s.imageUrl)}
                      className="btn-primary text-xs"
                    >
                      ✓ Use this
                    </button>
                    <button
                      type="button"
                      onClick={() => setRow(a.id, { status: "skipped" })}
                      className="btn-secondary text-xs"
                    >
                      Skip
                    </button>
                    <button
                      type="button"
                      onClick={() => preview(a.id)}
                      className="text-xs text-buzz-mute hover:text-buzz-text px-2"
                    >
                      Re-fetch
                    </button>
                  </div>
                )}

                {s.status === "applied" && (
                  <span className="text-xs text-emerald-400">✓ Saved — reload to see it in lists</span>
                )}

                {s.status === "skipped" && (
                  <button
                    type="button"
                    onClick={() => setRow(a.id, { status: "idle" })}
                    className="text-xs text-buzz-mute hover:text-buzz-text self-start"
                  >
                    Skipped · click to retry
                  </button>
                )}

                {s.status === "error" && (
                  <div className="text-xs text-rose-300">
                    <div>⚠ {s.message}</div>
                    <button
                      type="button"
                      onClick={() => setRow(a.id, { status: "idle" })}
                      className="text-buzz-mute hover:text-buzz-text mt-1"
                    >
                      Try again
                    </button>
                  </div>
                )}
              </div>

              {/* Right: preview thumb */}
              <div className="shrink-0">
                <div className="text-[10px] uppercase tracking-wider text-buzz-mute mb-1">Preview</div>
                <div className="w-20 h-20 rounded-lg bg-buzz-surface border border-buzz-border overflow-hidden grid place-items-center">
                  {s.status === "preview" || s.status === "applying" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.imageUrl} alt="" className="w-full h-full object-cover" />
                  ) : s.status === "applied" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.imageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-buzz-mute text-xs">—</span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// "Find FB URL" mode — admin Googles each artist + pastes the page
// URL. We save it to artists.facebook, the artist drops out of this
// view (they now have a FB URL), and they appear in the "Missing image
// only" filter ready for the og:image puller.
function FindFbUrlList({ artists }: { artists: Artist[] }) {
  type FindState =
    | { status: "idle" }
    | { status: "searching" }
    | { status: "candidates"; urls: string[]; query: string }
    | { status: "saving" }
    | { status: "saved" }
    | { status: "error"; message: string };

  const [states, setStates] = useState<Record<string, FindState>>(() =>
    Object.fromEntries(artists.map((a) => [a.id, { status: "idle" } as FindState])),
  );
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [bulkRunning, setBulkRunning] = useState(false);

  function setRow(id: string, s: FindState) {
    setStates((prev) => ({ ...prev, [id]: s }));
  }

  async function autoFind(id: string) {
    setRow(id, { status: "searching" });
    const r = await findArtistFacebookUrl(id);
    if ("error" in r) {
      setRow(id, { status: "error", message: r.error });
      return;
    }
    if (r.candidates.length === 0) {
      // Fall through to manual paste-in mode. Don't blame a specific
      // engine here — the backend tries Bing + DDG, and "no results"
      // could mean either "genuinely no FB page" or "both blocked us".
      setRow(id, { status: "error", message: `Couldn't find a Facebook page via auto-search. Try the manual Google link below + paste the URL.` });
      return;
    }
    setRow(id, { status: "candidates", urls: r.candidates, query: r.query });
  }

  async function save(id: string, url?: string) {
    const value = (url ?? inputs[id] ?? "").trim();
    if (!value) return;
    setRow(id, { status: "saving" });
    const r = await saveArtistFacebookUrl(id, value);
    if ("error" in r) {
      setRow(id, { status: "error", message: r.error });
    } else {
      setRow(id, { status: "saved" });
      setInputs((p) => ({ ...p, [id]: "" }));
    }
  }

  async function runBulkAutoFind() {
    if (bulkRunning) return;
    setBulkRunning(true);
    // Walk idle rows serially with a polite gap so DuckDuckGo doesn't
    // rate-limit us. Admin still has to pick which candidate to save.
    for (const a of artists) {
      const s = states[a.id];
      if (s?.status !== "idle") continue;
      await autoFind(a.id);
      await new Promise((r) => setTimeout(r, 1200));
    }
    setBulkRunning(false);
  }

  const idleCount = Object.values(states).filter((s) => s.status === "idle").length;

  if (artists.length === 0) {
    return (
      <div className="card p-10 text-center text-buzz-mute">
        Every artist has a Facebook URL set. Switch to <strong>Missing image
        only</strong> to pull their pics.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="card p-4 border-amber-500/30 bg-amber-500/5">
        <p className="text-sm">
          🤖 Click <strong>Auto-find</strong> on any artist — we search
          DuckDuckGo for their Facebook page and show you the candidates.
          Click the right one to save. Or paste a URL manually if DDG
          doesn&apos;t find it.
        </p>
      </div>

      <div className="card p-3 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-buzz-mute">
          {artists.length} artist{artists.length === 1 ? "" : "s"} in this view · {idleCount} unprocessed
        </p>
        <button
          type="button"
          onClick={runBulkAutoFind}
          disabled={bulkRunning || idleCount === 0}
          className="btn-secondary text-sm"
        >
          {bulkRunning ? "Searching…" : `🤖 Auto-find all (${idleCount})`}
        </button>
      </div>

      <ul className="card divide-y divide-buzz-border/60">
        {artists.map((a) => {
          const s = states[a.id] ?? { status: "idle" };
          const value = inputs[a.id] ?? "";
          const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(`"${a.name}" facebook page`)}`;
          return (
            <li key={a.id} className="p-4 flex gap-4 items-start">
              {/* Current pic (if any) for visual context */}
              <div className="shrink-0">
                <div className="w-16 h-16 rounded-lg bg-buzz-surface border border-buzz-border overflow-hidden grid place-items-center">
                  {a.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.imageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl text-buzz-mute">🎤</span>
                  )}
                </div>
              </div>

              <div className="flex-1 min-w-0 flex flex-col gap-2">
                <div>
                  <a
                    href={`/artists/${a.slug}`}
                    target="_blank"
                    rel="noopener"
                    className="font-medium hover:text-buzz-accent truncate block"
                  >
                    {a.name}
                  </a>
                  <span className="text-xs text-buzz-mute">No Facebook URL set</span>
                </div>

                {s.status === "saved" && (
                  <div className="text-xs text-emerald-400">
                    ✓ Saved — switch to &quot;Missing image only&quot; to pull their pic now
                  </div>
                )}

                {s.status === "idle" && (
                  <div className="flex gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => autoFind(a.id)}
                      className="btn-primary text-xs"
                    >
                      🤖 Auto-find
                    </button>
                    <a
                      href={googleUrl}
                      target="_blank"
                      rel="noopener"
                      className="btn-secondary text-xs inline-flex items-center gap-1"
                    >
                      🔎 Manual search ↗
                    </a>
                  </div>
                )}

                {s.status === "searching" && (
                  <span className="text-xs text-buzz-mute italic">Searching DuckDuckGo…</span>
                )}

                {s.status === "saving" && (
                  <span className="text-xs text-buzz-mute italic">Saving…</span>
                )}

                {s.status === "candidates" && (
                  <div className="flex flex-col gap-2">
                    <p className="text-[11px] text-buzz-mute">
                      Found {s.urls.length} candidate{s.urls.length === 1 ? "" : "s"} — tap <strong>👀 View</strong> to open the FB page in a new tab and check, <strong>✓ Use</strong> to save:
                    </p>
                    {s.urls.map((url) => (
                      <div
                        key={url}
                        className="flex items-stretch gap-0 rounded-lg bg-buzz-card border border-buzz-border hover:border-buzz-accent transition overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => save(a.id, url)}
                          className="px-3 py-2 text-buzz-accent text-xs font-semibold hover:bg-buzz-accent hover:text-black transition shrink-0"
                          aria-label="Save this Facebook URL"
                        >
                          ✓ Use
                        </button>
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 min-w-0 px-3 py-2 text-xs font-mono truncate flex items-center gap-2 hover:text-buzz-accent border-l border-buzz-border"
                          aria-label="Open this Facebook page in a new tab to verify"
                        >
                          <span className="shrink-0">👀</span>
                          <span className="truncate">{url}</span>
                          <span className="text-buzz-mute shrink-0 ml-auto">↗</span>
                        </a>
                      </div>
                    ))}
                    <details className="text-xs">
                      <summary className="cursor-pointer text-buzz-mute hover:text-buzz-text">
                        None look right? Paste manually
                      </summary>
                      <div className="flex gap-2 items-center mt-2">
                        <input
                          type="url"
                          value={value}
                          onChange={(e) => setInputs((p) => ({ ...p, [a.id]: e.target.value }))}
                          placeholder="Paste their facebook.com URL"
                          className="input flex-1 text-sm font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => save(a.id)}
                          disabled={!value.trim()}
                          className="btn-primary text-xs"
                        >
                          Save
                        </button>
                      </div>
                      <a
                        href={googleUrl}
                        target="_blank"
                        rel="noopener"
                        className="text-buzz-accent hover:underline mt-1 inline-block"
                      >
                        🔎 Or search Google manually ↗
                      </a>
                    </details>
                  </div>
                )}

                {s.status === "error" && (
                  <div className="flex flex-col gap-2">
                    <div className="text-xs text-rose-300">⚠ {s.message}</div>
                    <div className="flex gap-2 items-center">
                      <input
                        type="url"
                        value={value}
                        onChange={(e) => setInputs((p) => ({ ...p, [a.id]: e.target.value }))}
                        placeholder="Paste their facebook.com URL"
                        className="input flex-1 text-sm font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => save(a.id)}
                        disabled={!value.trim()}
                        className="btn-primary text-xs"
                      >
                        Save
                      </button>
                      <a
                        href={googleUrl}
                        target="_blank"
                        rel="noopener"
                        className="text-xs text-buzz-mute hover:text-buzz-text shrink-0"
                      >
                        🔎 Google ↗
                      </a>
                    </div>
                    <button
                      type="button"
                      onClick={() => autoFind(a.id)}
                      className="text-xs text-buzz-mute hover:text-buzz-text self-start"
                    >
                      Try auto-find again
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
