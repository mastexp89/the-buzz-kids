"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { updateOrganiser } from "../../../organiser-setup/actions";
import type { Organiser } from "@/lib/types";

const SOCIAL_FIELDS: Array<{ key: keyof Organiser; label: string; placeholder: string }> = [
  { key: "website", label: "Website", placeholder: "https://your-site.com" },
  { key: "instagram", label: "Instagram", placeholder: "https://instagram.com/handle" },
  { key: "facebook", label: "Facebook", placeholder: "https://facebook.com/page" },
  { key: "twitter", label: "X / Twitter", placeholder: "https://x.com/handle" },
  { key: "tiktok", label: "TikTok", placeholder: "https://tiktok.com/@handle" },
  { key: "spotify", label: "Spotify", placeholder: "https://open.spotify.com/..." },
  { key: "bandcamp", label: "Bandcamp", placeholder: "https://you.bandcamp.com" },
  { key: "youtube", label: "YouTube", placeholder: "https://youtube.com/@channel" },
];

export default function EditOrganiserClient({ organiser }: { organiser: Organiser }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState(organiser.image_url ?? "");
  const [uploading, setUploading] = useState(false);

  // Local form state — controlled inputs.
  const [fields, setFields] = useState({
    name: organiser.name,
    bio: organiser.bio ?? "",
    email: organiser.email ?? "",
    website: organiser.website ?? "",
    instagram: organiser.instagram ?? "",
    facebook: organiser.facebook ?? "",
    twitter: organiser.twitter ?? "",
    tiktok: organiser.tiktok ?? "",
    spotify: organiser.spotify ?? "",
    bandcamp: organiser.bandcamp ?? "",
    youtube: organiser.youtube ?? "",
  });

  function set<K extends keyof typeof fields>(k: K, v: string) {
    setFields((s) => ({ ...s, [k]: v }));
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const supabase = createClient();
      // Reuse the artist-images bucket (configured for public read in sql/018)
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `organiser-${organiser.id}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("artist-images")
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("artist-images").getPublicUrl(path);
      setImageUrl(data.publicUrl);
    } catch (e: any) {
      setError(`Couldn't upload image: ${e?.message ?? e}`);
    } finally {
      setUploading(false);
    }
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await updateOrganiser(organiser.id, {
        name: fields.name,
        bio: fields.bio || null,
        email: fields.email || null,
        image_url: imageUrl || null,
        website: fields.website || null,
        instagram: fields.instagram || null,
        facebook: fields.facebook || null,
        twitter: fields.twitter || null,
        tiktok: fields.tiktok || null,
        spotify: fields.spotify || null,
        bandcamp: fields.bandcamp || null,
        youtube: fields.youtube || null,
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setInfo("Saved.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-6">
      {/* Image */}
      <div className="card p-5">
        <label className="label">Profile image</label>
        <div className="flex items-center gap-4 mt-2">
          {imageUrl ? (
            <div
              className="w-24 h-24 rounded-xl bg-buzz-surface border border-buzz-border shrink-0"
              style={{
                backgroundImage: `url(${imageUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
          ) : (
            <div className="w-24 h-24 rounded-xl bg-buzz-surface border border-buzz-border grid place-items-center text-3xl shrink-0">
              📋
            </div>
          )}
          <div className="flex-1">
            <input
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              disabled={uploading}
              className="block text-sm text-buzz-mute file:mr-3 file:py-2 file:px-4 file:rounded file:border-0 file:bg-buzz-accent file:text-buzz-bg file:font-medium file:cursor-pointer hover:file:bg-buzz-accent2"
            />
            {imageUrl && (
              <button
                type="button"
                onClick={() => setImageUrl("")}
                className="text-xs text-rose-400 hover:text-rose-300 mt-2"
              >
                Remove image
              </button>
            )}
            {uploading && <p className="text-xs text-buzz-mute mt-1">Uploading…</p>}
          </div>
        </div>
      </div>

      {/* Basics */}
      <div className="card p-5 flex flex-col gap-4">
        <div>
          <label className="label">Name</label>
          <input
            className="input"
            required
            value={fields.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Bio</label>
          <textarea
            className="input min-h-[120px]"
            value={fields.bio}
            onChange={(e) => set("bio", e.target.value)}
            placeholder="What you do, what you put on, where you're based — a few sentences."
          />
        </div>
        <div>
          <label className="label">Contact email</label>
          <input
            type="email"
            className="input"
            value={fields.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="bookings@yourpromoter.com"
          />
          <p className="help">Optional. Public on your profile if set.</p>
        </div>
      </div>

      {/* Socials */}
      <div className="card p-5 flex flex-col gap-3">
        <div className="eyebrow text-[10px] mb-1">Socials</div>
        {SOCIAL_FIELDS.map(({ key, label, placeholder }) => (
          <div key={key as string}>
            <label className="label text-xs">{label}</label>
            <input
              className="input"
              type="url"
              value={fields[key as keyof typeof fields] as string}
              onChange={(e) => set(key as keyof typeof fields, e.target.value)}
              placeholder={placeholder}
            />
          </div>
        ))}
      </div>

      {error && (
        <div className="card p-3 text-sm text-rose-400 border-rose-500/40">{error}</div>
      )}
      {info && (
        <div className="card p-3 text-sm text-emerald-400 border-emerald-500/40">{info}</div>
      )}

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy || uploading}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
