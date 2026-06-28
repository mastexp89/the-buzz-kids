"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ImageUploader from "@/components/ImageUploader";
import { updateArtist } from "./actions";

type Artist = {
  id: string;
  slug: string;
  name: string;
  bio: string | null;
  image_url: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  twitter: string | null;
  tiktok: string | null;
  spotify: string | null;
  bandcamp: string | null;
  youtube: string | null;
};

export default function EditArtistClient({ artist, isAdmin = false }: { artist: Artist; isAdmin?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [name, setName] = useState(artist.name ?? "");
  const [slug, setSlug] = useState(artist.slug ?? "");
  const [bio, setBio] = useState(artist.bio ?? "");
  const [imageUrl, setImageUrl] = useState(artist.image_url ?? "");
  const [website, setWebsite] = useState(artist.website ?? "");
  const [instagram, setInstagram] = useState(artist.instagram ?? "");
  const [facebook, setFacebook] = useState(artist.facebook ?? "");
  const [twitter, setTwitter] = useState(artist.twitter ?? "");
  const [tiktok, setTiktok] = useState(artist.tiktok ?? "");
  const [spotify, setSpotify] = useState(artist.spotify ?? "");
  const [bandcamp, setBandcamp] = useState(artist.bandcamp ?? "");
  const [youtube, setYoutube] = useState(artist.youtube ?? "");

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSavedAt(null);
    start(async () => {
      const patch: any = {
        name,
        bio,
        image_url: imageUrl,
        website,
        instagram,
        facebook,
        twitter,
        tiktok,
        spotify,
        bandcamp,
        youtube,
      };
      // Only send slug if admin and it changed
      if (isAdmin && slug.trim() && slug.trim() !== artist.slug) {
        patch.slug = slug.trim();
      }
      const r = await updateArtist(artist.id, patch);
      if ("error" in r) setError(r.error);
      else {
        setSavedAt(Date.now());
        // If slug was changed, the URL we're on no longer matches — refresh
        // so the back-link reflects the new slug.
        if (r.slug && r.slug !== artist.slug) router.refresh();
      }
    });
  }

  return (
    <form onSubmit={save} className="card p-6 grid sm:grid-cols-2 gap-4">
      <div className="sm:col-span-2">
        <label className="label">Profile photo</label>
        <ImageUploader folder="artists" value={imageUrl} onChange={setImageUrl} />
        <p className="help">Square works best. JPEG/PNG up to ~5MB.</p>
      </div>

      <div className="sm:col-span-2">
        <label className="label">Artist / Band name</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
        />
      </div>

      {isAdmin && (
        <div className="sm:col-span-2">
          <label className="label">URL slug <span className="text-buzz-accent text-[10px] uppercase ml-1">admin only</span></label>
          <div className="flex items-center gap-2">
            <span className="text-buzz-mute text-sm font-mono whitespace-nowrap">/artists/</span>
            <input
              className="input flex-1 font-mono"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              maxLength={100}
              placeholder="my-band-name"
            />
          </div>
          <p className="help">Lowercase letters, numbers and hyphens. Changing this breaks any external links to the old URL.</p>
        </div>
      )}

      <div className="sm:col-span-2">
        <label className="label">Bio</label>
        <textarea
          className="input min-h-[160px]"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Who you are, what you sound like, where you've played, anything fans should know."
          maxLength={2000}
        />
        <p className="help">{bio.length} / 2000</p>
      </div>

      <div className="sm:col-span-2 mt-2">
        <p className="eyebrow mb-1">Links</p>
        <hr className="border-buzz-border" />
      </div>

      <div>
        <label className="label">Website</label>
        <input className="input" type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
      </div>
      <div>
        <label className="label">Instagram</label>
        <input className="input" type="url" value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="https://instagram.com/…" />
      </div>
      <div>
        <label className="label">Facebook</label>
        <input className="input" type="url" value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="https://facebook.com/…" />
      </div>
      <div>
        <label className="label">Twitter / X</label>
        <input className="input" type="url" value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="https://x.com/…" />
      </div>
      <div>
        <label className="label">TikTok</label>
        <input className="input" type="url" value={tiktok} onChange={(e) => setTiktok(e.target.value)} placeholder="https://tiktok.com/@…" />
      </div>
      <div>
        <label className="label">Spotify</label>
        <input className="input" type="url" value={spotify} onChange={(e) => setSpotify(e.target.value)} placeholder="https://open.spotify.com/artist/…" />
      </div>
      <div>
        <label className="label">Bandcamp</label>
        <input className="input" type="url" value={bandcamp} onChange={(e) => setBandcamp(e.target.value)} placeholder="https://bandcamp.com/…" />
      </div>
      <div>
        <label className="label">YouTube</label>
        <input className="input" type="url" value={youtube} onChange={(e) => setYoutube(e.target.value)} placeholder="https://youtube.com/@…" />
      </div>

      {error && <div className="sm:col-span-2 text-sm text-rose-400">{error}</div>}

      <div className="sm:col-span-2 flex flex-wrap gap-3 items-center pt-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </button>
        {savedAt && (
          <span className="text-xs text-emerald-400">Saved ✓</span>
        )}
      </div>
    </form>
  );
}
