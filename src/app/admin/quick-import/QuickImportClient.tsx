"use client";

// Admin Quick Import — poster entry point.
// Two ways to feed posters in:
//   1. File upload (1-5 local images) — uploaded to our storage, then extracted.
//   2. URL paste (1-5 image URLs, one per line) — extraction runs against the
//      remote URL directly. The image gets pulled into our storage at publish
//      time via `uploadPosterFromUrl`, so events end up with persisted posters.

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { extractQuickFromPoster } from "./actions";
import QuickImportReview, {
  resolveVenueFromHint,
  type Row,
} from "@/components/QuickImportReview";
import type { ChipArtist } from "@/components/ArtistChipPicker";

const MAX_POSTERS = 5;

type Phase = "idle" | "processing" | "reviewing";

export default function QuickImportClient() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files).slice(0, MAX_POSTERS);
    setError(null);
    setPhase("processing");
    setProgress(`Uploading ${list.length} poster${list.length === 1 ? "" : "s"}…`);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Not signed in."); setPhase("idle"); return; }

    const posterUrls: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      setProgress(`Uploading poster ${i + 1} of ${list.length}…`);
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `events/${user.id}/${Date.now()}-${i}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("media")
        .upload(path, file, { upsert: false, contentType: file.type || "image/jpeg" });
      if (upErr) { setError(`Upload failed: ${upErr.message}`); setPhase("idle"); return; }
      const { data } = supabase.storage.from("media").getPublicUrl(path);
      posterUrls.push(data.publicUrl);
    }

    await runExtraction(posterUrls);
  }

  async function handleUrls() {
    const urls = urlInput
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (urls.length === 0) {
      setError("Paste at least one image URL.");
      return;
    }
    if (urls.length > MAX_POSTERS) {
      setError(`Up to ${MAX_POSTERS} URLs at a time.`);
      return;
    }
    // Validate URLs up front
    for (const u of urls) {
      try {
        const p = new URL(u);
        if (p.protocol !== "http:" && p.protocol !== "https:") {
          setError(`Not a valid http(s) URL: ${u}`);
          return;
        }
      } catch {
        setError(`Not a valid URL: ${u}`);
        return;
      }
    }
    setError(null);
    setPhase("processing");
    await runExtraction(urls);
  }

  // Shared extraction loop — same logic for uploaded files and pasted URLs,
  // since both end up as a list of image URLs the AI can fetch.
  async function runExtraction(posterUrls: string[]) {
    const newRows: Row[] = [];
    for (let i = 0; i < posterUrls.length; i++) {
      setProgress(`Reading poster ${i + 1} of ${posterUrls.length}…`);
      const r = await extractQuickFromPoster({ imageUrl: posterUrls[i] });
      if ("error" in r) {
        setError(r.error);
        setPhase("idle");
        return;
      }
      for (const d of r.drafts) {
        // Server pre-matches artist names against the artists table; respect
        // the match so the chip renders as confirmed-existing instead of "(new)".
        const artistChips: ChipArtist[] = d.artists.map((a) =>
          a.matchedArtistId
            ? { kind: "existing" as const, id: a.matchedArtistId, name: a.name }
            : { kind: "new" as const, name: a.name },
        );
        const venue = await resolveVenueFromHint(d.venue_hint);
        newRows.push({
          key: `${posterUrls[i]}-${newRows.length}`,
          posterImageUrl: posterUrls[i],
          draft: d,
          venue,
          artists: artistChips,
          state: "idle",
        });
      }
    }
    setRows(newRows);
    setProgress(null);
    setPhase(newRows.length > 0 ? "reviewing" : "idle");
    if (newRows.length === 0) {
      setError("Couldn't pull any gigs out of those posters. Try a clearer image.");
    }
  }

  function reset() {
    setRows([]);
    setError(null);
    setProgress(null);
    setUrlInput("");
    setPhase("idle");
  }

  if (phase === "reviewing") {
    return <QuickImportReview initialRows={rows} onReset={reset} resetLabel="Cancel" />;
  }

  const busy = phase === "processing";

  return (
    <div className="card p-6 flex flex-col gap-5">
      <div>
        <h3 className="h-display text-2xl mb-2">📸 Drop posters</h3>
        <p className="text-buzz-mute text-sm max-w-xl">
          Up to {MAX_POSTERS} at once. Claude will pull venue + lineup + date/time + price off each one.
        </p>
      </div>

      <div>
        <label className="label mb-2">Upload from your computer</label>
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={busy}
          onChange={(e) => handleFiles(e.target.files)}
          className="block text-sm text-buzz-mute file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-buzz-surface file:text-buzz-text hover:file:bg-buzz-card cursor-pointer"
        />
      </div>

      <div className="flex items-center gap-2 text-buzz-mute text-xs">
        <span className="flex-1 h-px bg-buzz-border" />
        <span>or</span>
        <span className="flex-1 h-px bg-buzz-border" />
      </div>

      <div>
        <label className="label mb-2">Paste image URL(s) — one per line</label>
        <textarea
          className="input min-h-[80px] font-mono text-sm"
          placeholder={`https://example.com/poster-1.jpg\nhttps://example.com/poster-2.jpg`}
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleUrls();
          }}
        />
        <div className="flex justify-between items-center mt-2">
          <p className="text-[11px] text-buzz-mute">
            Image is downloaded automatically and persisted to our storage when you publish. ⌘/Ctrl+Enter to import.
          </p>
          <button
            type="button"
            onClick={handleUrls}
            disabled={busy || urlInput.trim().length === 0}
            className="btn-secondary text-xs"
          >
            {busy ? "Working…" : "Import from URL"}
          </button>
        </div>
      </div>

      {progress && <div className="text-xs text-buzz-accent">{progress}</div>}
      {error && <div className="text-sm text-rose-400">{error}</div>}
    </div>
  );
}
