"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { resizeImageFile } from "@/lib/imageResize";
import { uploadImageFromUrl } from "./ImageUploader-actions";

export default function ImageUploader({
  folder,
  value,
  onChange,
  maxDimension = 1600,
}: {
  folder: "venues" | "events" | "artists" | "festivals" | "sponsors";
  value: string;
  onChange: (url: string) => void;
  maxDimension?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      console.log("[ImageUploader] picked", { name: file.name, type: file.type, size: file.size });

      // 1. Downscale big images on the device before uploading
      setProgressLabel("Resizing…");
      const resized = await resizeImageFile(file, {
        maxWidth: maxDimension,
        maxHeight: maxDimension,
        quality: 0.82,
      });
      console.log("[ImageUploader] after resize", { name: resized.name, type: resized.type, size: resized.size });

      // 2. Upload
      setProgressLabel("Uploading…");
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("You're not signed in.");

      const ext = (resized.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${folder}/${user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("media").upload(path, resized, {
        upsert: false,
        cacheControl: "3600",
        contentType: resized.type || "image/jpeg",
      });
      if (upErr) {
        console.error("[ImageUploader] storage upload error", upErr);
        throw upErr;
      }
      const { data } = supabase.storage.from("media").getPublicUrl(path);
      console.log("[ImageUploader] uploaded:", data.publicUrl);
      onChange(data.publicUrl);
    } catch (e: any) {
      console.error("[ImageUploader] failed", e);
      setError(e.message ?? "Upload failed");
    } finally {
      setBusy(false);
      setProgressLabel(null);
    }
  }

  async function handleUrl() {
    const url = urlInput.trim();
    if (!url) return;
    setUrlBusy(true);
    setError(null);
    try {
      const r = await uploadImageFromUrl({ folder, url });
      if ("error" in r) {
        setError(r.error);
        return;
      }
      onChange(r.publicUrl);
      setUrlInput("");
    } finally {
      setUrlBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row gap-3 items-start">
        {value && (
          <div
            className="w-32 h-20 rounded-lg bg-buzz-surface border border-buzz-border shrink-0"
            style={{ backgroundImage: `url(${value})`, backgroundSize: "cover", backgroundPosition: "center" }}
          />
        )}
        <div className="flex-1">
          <input
            type="file"
            accept="image/*"
            disabled={busy || urlBusy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
            className="block text-sm text-buzz-mute file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-buzz-surface file:text-buzz-text hover:file:bg-buzz-card cursor-pointer"
          />
          {busy && <div className="text-xs text-buzz-mute mt-1">{progressLabel ?? "Uploading…"}</div>}
          {error && <div className="text-xs text-buzz-accent2 mt-1">{error}</div>}
          {value && (
            <button type="button" onClick={() => onChange("")} className="text-xs text-buzz-mute hover:text-buzz-text mt-1">
              Remove image
            </button>
          )}
        </div>
      </div>

      {/* URL input — paste an image URL (FB profile pic, og:image, etc.) and we'll
          download + persist it server-side, no CORS hassle. */}
      <div className="flex flex-col sm:flex-row gap-2 items-stretch">
        <input
          type="url"
          placeholder="…or paste an image URL (FB, website, etc.)"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          disabled={busy || urlBusy}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleUrl(); } }}
          className="input flex-1 text-sm"
        />
        <button
          type="button"
          onClick={handleUrl}
          disabled={busy || urlBusy || !urlInput.trim()}
          className="btn-secondary text-xs whitespace-nowrap"
        >
          {urlBusy ? "Fetching…" : "Use URL"}
        </button>
      </div>
    </div>
  );
}
