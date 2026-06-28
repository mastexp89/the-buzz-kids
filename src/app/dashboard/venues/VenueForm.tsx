"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { City, Venue } from "@/lib/types";
import { saveVenue } from "./actions";
import ImageUploader from "@/components/ImageUploader";
import GalleryUploader from "@/components/GalleryUploader";
import OpeningHoursEditor, { type OpeningHours } from "@/components/OpeningHoursEditor";

export default function VenueForm({
  venue,
  cities,
  ownerOverride,
  redirectAfterCreate,
  isAdmin = false,
}: {
  venue: Venue | null;
  cities: City[];
  /** Admin-only: assign the new venue to this user instead of the current admin */
  ownerOverride?: string;
  /** Override where to send the user after a successful create */
  redirectAfterCreate?: string;
  /** Show the admin-only slug edit field */
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState(venue?.logo_url ?? "");
  const [gallery, setGallery] = useState<string[]>(venue?.gallery_image_urls ?? []);
  const [openingHours, setOpeningHours] = useState<OpeningHours>(
    ((venue as any)?.opening_hours_json ?? {}) as OpeningHours,
  );

  const dundee = cities.find((c) => c.slug === "dundee")?.id;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const fd = new FormData(e.currentTarget);
    fd.set("logo_url", logoUrl);
    fd.delete("gallery");
    gallery.forEach((u) => fd.append("gallery", u));
    // Strip empty days from opening_hours_json
    const ohClean: OpeningHours = {};
    for (const [k, v] of Object.entries(openingHours)) {
      if (!v) continue;
      if (v.closed) ohClean[k as keyof OpeningHours] = { closed: true };
      else if (v.open && v.close) ohClean[k as keyof OpeningHours] = { open: v.open, close: v.close };
    }
    fd.set("opening_hours_json", Object.keys(ohClean).length > 0 ? JSON.stringify(ohClean) : "");
    if (venue?.id) fd.set("venue_id", venue.id);
    if (ownerOverride) fd.set("owner_id_override", ownerOverride);
    start(async () => {
      const res = await saveVenue(fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      if (redirectAfterCreate && res?.redirectTo) {
        router.push(redirectAfterCreate);
        return;
      }
      if (res?.redirectTo) {
        router.push(res.redirectTo);
        return;
      }
      // Edit-in-place save: refresh server data + flash a confirmation.
      router.refresh();
      setInfo("Changes saved.");
    });
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 grid sm:grid-cols-2 gap-4">
      <div className="sm:col-span-2">
        <label className="label">Venue name *</label>
        <input className="input" name="name" required defaultValue={venue?.name ?? ""} placeholder="The Buzz Bar" />
      </div>
      {isAdmin && venue?.slug && (
        <div className="sm:col-span-2">
          <label className="label">URL slug <span className="text-buzz-accent text-[10px] uppercase ml-1">admin only</span></label>
          <div className="flex items-center gap-2">
            <span className="text-buzz-mute text-sm font-mono whitespace-nowrap">/dundee/venues/</span>
            <input
              className="input flex-1 font-mono"
              name="slug"
              defaultValue={venue.slug}
              maxLength={100}
            />
          </div>
          <p className="help">Lowercase letters, numbers and hyphens. Changing this breaks any external links to the old URL.</p>
        </div>
      )}
      <div>
        <label className="label">City *</label>
        <select className="input" name="city_id" required defaultValue={venue?.city_id ?? dundee ?? ""}>
          <option value="" disabled>Choose…</option>
          {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Postcode</label>
        <input className="input" name="postcode" defaultValue={venue?.postcode ?? ""} placeholder="DD1 1AB" />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Address</label>
        <input className="input" name="address" defaultValue={venue?.address ?? ""} placeholder="103 Nethergate, Dundee" />
      </div>
      <div>
        <label className="label">Phone</label>
        <input className="input" name="phone" defaultValue={venue?.phone ?? ""} />
      </div>
      <div>
        <label className="label">Public email</label>
        <input className="input" name="email" type="email" defaultValue={venue?.email ?? ""} />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Website</label>
        <input className="input" name="website" type="url" defaultValue={venue?.website ?? ""} placeholder="https://" />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Description</label>
        <textarea className="input min-h-[120px]" name="description" defaultValue={venue?.description ?? ""}
          placeholder="What's your venue about? Sound system, capacity, regular nights…" />
      </div>

      <div className="sm:col-span-2">
        <label className="label">Opening hours</label>
        <OpeningHoursEditor value={openingHours} onChange={setOpeningHours} />
        <p className="help mt-2">Set times per day. Tick "Closed" for any day you're not open.</p>
      </div>

      <div className="sm:col-span-2 grid sm:grid-cols-2 gap-3 border-t border-buzz-border/60 pt-5 mt-2">
        <div className="sm:col-span-2 mb-1">
          <p className="eyebrow text-[10px]">Social links</p>
          <p className="help">Full URLs — leave any blank if you don't use them.</p>
        </div>
        <div>
          <label className="label">Instagram</label>
          <input className="input" name="instagram" type="url" defaultValue={venue?.instagram ?? ""} placeholder="https://instagram.com/yourvenue" />
        </div>
        <div>
          <label className="label">Facebook</label>
          <input className="input" name="facebook" type="url" defaultValue={venue?.facebook ?? ""} placeholder="https://facebook.com/yourvenue" />
        </div>
        <div>
          <label className="label">X / Twitter</label>
          <input className="input" name="twitter" type="url" defaultValue={venue?.twitter ?? ""} placeholder="https://x.com/yourvenue" />
        </div>
        <div>
          <label className="label">TikTok</label>
          <input className="input" name="tiktok" type="url" defaultValue={venue?.tiktok ?? ""} placeholder="https://tiktok.com/@yourvenue" />
        </div>
        <div>
          <label className="label">Spotify</label>
          <input className="input" name="spotify" type="url" defaultValue={venue?.spotify ?? ""} placeholder="https://open.spotify.com/…" />
        </div>
        <div>
          <label className="label">YouTube</label>
          <input className="input" name="youtube" type="url" defaultValue={venue?.youtube ?? ""} placeholder="https://youtube.com/@yourvenue" />
        </div>
      </div>

      <div className="sm:col-span-2 grid sm:grid-cols-2 gap-4 border-t border-buzz-border/60 pt-5 mt-2">
        <div>
          <label className="label">Logo (square)</label>
          <p className="help mb-2">Square brand logo — shown next to your venue name. PNG with transparent background works best.</p>
          <ImageUploader folder="venues" value={logoUrl} onChange={setLogoUrl} />
        </div>
      </div>

      <div className="sm:col-span-2 border-t border-buzz-border/60 pt-5 mt-2">
        <label className="label">Photos of the venue</label>
        <p className="help mb-3">
          Show off the inside, the stage, the bar, the layout. Up to 10 photos.
        </p>
        <GalleryUploader initial={gallery} onChange={setGallery} folder="venues" max={10} />
      </div>

      {error && <div className="sm:col-span-2 text-sm text-rose-400">{error}</div>}
      {info && <div className="sm:col-span-2 text-sm text-emerald-400">✓ {info}</div>}
      <div className="sm:col-span-2 flex gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : venue ? "Save changes" : "Submit for review"}
        </button>
      </div>
    </form>
  );
}
