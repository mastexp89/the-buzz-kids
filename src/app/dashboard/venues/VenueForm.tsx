"use client";

import { useState, useTransition, useRef } from "react";
import AddressAutocomplete from "@/components/AddressAutocomplete";
import type { PlaceDetails } from "@/app/dashboard/venues/place-actions";
import { useRouter } from "next/navigation";
import type { City, Venue, Genre } from "@/lib/types";
import { saveVenue } from "./actions";
import ImageUploader from "@/components/ImageUploader";
import GalleryUploader from "@/components/GalleryUploader";
import OpeningHoursEditor, { type OpeningHours } from "@/components/OpeningHoursEditor";
import { ACCESS_FACETS } from "@/lib/accessibility";

export default function VenueForm({
  venue,
  cities,
  categories = [],
  currentCategories = [],
  ownerOverride,
  redirectAfterCreate,
  isAdmin = false,
}: {
  venue: Venue | null;
  cities: City[];
  /** Activity categories to choose from (the genres taxonomy). */
  categories?: Genre[];
  /** Slugs of the categories this venue already has. */
  currentCategories?: string[];
  /** Admin-only: assign the new venue to this user instead of the current admin */
  ownerOverride?: string;
  /** Override where to send the user after a successful create */
  redirectAfterCreate?: string;
  /** Show the admin-only slug edit field */
  isAdmin?: boolean;
}) {
  const v = venue as any;
  const currentAccess: string[] = Array.isArray(v?.accessibility) ? v.accessibility : [];
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Refs so the Google place-search can fill these uncontrolled inputs.
  const nameRef = useRef<HTMLInputElement>(null);
  const postcodeRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const websiteRef = useRef<HTMLInputElement>(null);

  function fillFromPlace(p: PlaceDetails) {
    const set = (ref: React.RefObject<HTMLInputElement | null>, v: string) => {
      if (ref.current && v && !ref.current.value) ref.current.value = v; // don't clobber what's typed
    };
    // name always fills if empty; the rest fill in
    if (nameRef.current && p.name) nameRef.current.value = p.name;
    set(addressRef, p.address);
    set(postcodeRef, p.postcode);
    set(phoneRef, p.phone);
    set(websiteRef, p.website);
    setInfo("Filled from Google — check the details are right, then save.");
  }
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
      <div className="sm:col-span-2 rounded-xl border border-buzz-accent/30 bg-buzz-accent/5 p-3">
        <label className="label !mb-1">Find your place</label>
        <p className="help !mt-0 mb-2">Search Google and pick the right one — we'll auto-fill the name, address, postcode, phone and website.</p>
        <AddressAutocomplete onSelect={fillFromPlace} />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Venue name *</label>
        <input ref={nameRef} className="input" name="name" required defaultValue={venue?.name ?? ""} placeholder="The Buzz Bar" />
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
        <input ref={postcodeRef} className="input" name="postcode" defaultValue={venue?.postcode ?? ""} placeholder="DD1 1AB" />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Address</label>
        <input ref={addressRef} className="input" name="address" defaultValue={venue?.address ?? ""} placeholder="103 Nethergate, Dundee" />
      </div>
      <div>
        <label className="label">Phone</label>
        <input ref={phoneRef} className="input" name="phone" defaultValue={venue?.phone ?? ""} />
      </div>
      <div>
        <label className="label">Public email</label>
        <input className="input" name="email" type="email" defaultValue={venue?.email ?? ""} />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Website</label>
        <input ref={websiteRef} className="input" name="website" type="url" defaultValue={venue?.website ?? ""} placeholder="https://" />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Description</label>
        <textarea className="input min-h-[120px]" name="description" defaultValue={venue?.description ?? ""}
          placeholder="What's it like for families? What can the kids do, and what's handy to know…" />
      </div>

      {/* ---- For families: what powers the kids filters + badges ---- */}
      <div className="sm:col-span-2 grid sm:grid-cols-2 gap-4 border-t border-buzz-border/60 pt-5 mt-2">
        <div className="sm:col-span-2 mb-1">
          <p className="eyebrow text-[10px]">For families</p>
          <p className="help">This is what powers the filters and badges parents search by.</p>
        </div>

        <div className="sm:col-span-2">
          <label className="label">What kind of place is it?</label>
          <div className="flex flex-col gap-1.5 text-sm">
            {[
              ["attraction", "Always open to visit (soft play, park, farm…)"],
              ["programmes", "Runs dated sessions / events (classes, camps, shows)"],
              ["both", "Both — open to visit AND runs events"],
            ].map(([val, lbl]) => (
              <label key={val} className="flex items-center gap-2">
                <input type="radio" name="venue_type" value={val} defaultChecked={(v?.venue_type ?? "attraction") === val} /> {lbl}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Suitable ages</label>
          <div className="flex items-center gap-2">
            <input className="input !w-20" type="number" name="age_min" min={0} max={18} defaultValue={v?.age_min ?? ""} placeholder="0" />
            <span className="text-buzz-mute">to</span>
            <input className="input !w-20" type="number" name="age_max" min={0} max={18} defaultValue={v?.age_max ?? ""} placeholder="12" />
          </div>
          <p className="help">Leave blank for all ages.</p>
        </div>

        <div>
          <label className="label">Indoor or outdoor?</label>
          <div className="flex flex-wrap gap-3 text-sm mt-2">
            {[["indoor", "Indoor"], ["outdoor", "Outdoor"], ["both", "Both"]].map(([val, lbl]) => (
              <label key={val} className="flex items-center gap-1.5">
                <input type="radio" name="setting" value={val} defaultChecked={v?.setting === val} /> {lbl}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Price</label>
          <label className="flex items-center gap-2 text-sm mb-2">
            <input type="checkbox" name="is_free" defaultChecked={!!v?.is_free} /> Free to visit
          </label>
          <div className="flex items-center gap-2">
            <span className="text-buzz-mute text-sm">From £</span>
            <input className="input !w-24" type="number" step="0.01" name="price_from" min={0} defaultValue={v?.price_from ?? ""} placeholder="6.50" />
          </div>
          <input className="input mt-2" name="price_note" defaultValue={v?.price_note ?? ""} placeholder="e.g. £6.50 per child, adults free" />
        </div>

        <div>
          <label className="label">Booking</label>
          <label className="flex items-center gap-2 text-sm mb-2">
            <input type="checkbox" name="booking_required" defaultChecked={!!v?.booking_required} /> Booking needed
          </label>
          <input className="input" type="url" name="booking_url" defaultValue={v?.booking_url ?? ""} placeholder="https://…booking link" />
        </div>

        {categories.length > 0 && (
          <div className="sm:col-span-2">
            <label className="label">Categories</label>
            <p className="help mb-2">Pick all that fit — these are how families filter.</p>
            <div className="flex flex-wrap gap-2">
              {categories.map((g) => (
                <label key={g.id} className="chip cursor-pointer">
                  <input type="checkbox" name="category" value={g.slug} defaultChecked={currentCategories.includes(g.slug)} className="mr-1.5" /> {g.name}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="sm:col-span-2">
          <label className="label">Accessibility &amp; sensory</label>
          <p className="help mb-2">Tick anything you offer — only tick what you can confirm.</p>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
            {ACCESS_FACETS.map((f) => (
              <label key={f.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="accessibility" value={f.key} defaultChecked={currentAccess.includes(f.key)} />
                <span aria-hidden>{f.icon}</span> {f.label}
              </label>
            ))}
          </div>
        </div>
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
        <label className="label">Photos of your place</label>
        <p className="help mb-3">
          Show off the play areas, the activities and what families can expect. Up to 10 photos.
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
