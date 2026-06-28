"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { resizeImageFile } from "@/lib/imageResize";

export default function GalleryUploader({
  initial,
  onChange,
  folder = "venues",
  max = 10,
}: {
  initial: string[];
  onChange: (urls: string[]) => void;
  folder?: "venues" | "events";
  max?: number;
}) {
  const [urls, setUrls] = useState<string[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function emit(next: string[]) {
    setUrls(next);
    onChange(next);
  }

  async function handleFiles(files: File[]) {
    setBusy(true);
    setError(null);
    try {
      console.log("[GalleryUploader] picked", files.length, "files");
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("You're not signed in.");

      const remaining = Math.max(0, max - urls.length);
      const toUpload = files.slice(0, remaining);
      const newOnes: string[] = [];

      for (const file of toUpload) {
        console.log("[GalleryUploader] processing", file.name, file.type, file.size);
        const resized = await resizeImageFile(file, { maxWidth: 1600, maxHeight: 1600, quality: 0.82 });
        const ext = (resized.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${folder}/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
        console.log("[GalleryUploader] uploading to", path);
        const { error: upErr } = await supabase.storage.from("media").upload(path, resized, {
          upsert: false,
          cacheControl: "3600",
          contentType: resized.type || "image/jpeg",
        });
        if (upErr) {
          console.error("[GalleryUploader] storage error", upErr);
          throw upErr;
        }
        const { data } = supabase.storage.from("media").getPublicUrl(path);
        console.log("[GalleryUploader] uploaded:", data.publicUrl);
        newOnes.push(data.publicUrl);
      }
      console.log("[GalleryUploader] all done, emitting", newOnes.length, "new urls");
      emit([...urls, ...newOnes]);
    } catch (e: any) {
      console.error("[GalleryUploader] failed", e);
      setError(e.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  function remove(idx: number) {
    emit(urls.filter((_, i) => i !== idx));
  }

  return (
    <div className="flex flex-col gap-3">
      {urls.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {urls.map((u, i) => (
            <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-buzz-surface border border-buzz-border group">
              <div
                className="absolute inset-0"
                style={{ backgroundImage: `url(${u})`, backgroundSize: "cover", backgroundPosition: "center" }}
              />
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove photo"
                className="absolute top-1 right-1 bg-black/70 text-white rounded-full w-6 h-6 grid place-items-center text-xs opacity-0 group-hover:opacity-100 transition"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div>
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={busy || urls.length >= max}
          onChange={(e) => {
            // CRITICAL: snapshot the FileList into a real array BEFORE we reset
            // the input. e.target.files is a live reference that gets cleared
            // when we set value = "", and any await inside handleFiles would
            // see an empty list otherwise.
            const list = e.target.files;
            const files = list ? Array.from(list) : [];
            e.target.value = "";
            if (files.length > 0) handleFiles(files);
          }}
          className="block text-sm text-buzz-mute file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-buzz-surface file:text-buzz-text hover:file:bg-buzz-card cursor-pointer disabled:cursor-not-allowed"
        />
        <p className="help mt-1">
          {busy
            ? "Uploading…"
            : urls.length >= max
            ? `Max ${max} photos.`
            : `Up to ${max} photos. ${urls.length}/${max} uploaded.`}
        </p>
        {error && <div className="text-xs text-rose-400 mt-1">{error}</div>}
      </div>
    </div>
  );
}
