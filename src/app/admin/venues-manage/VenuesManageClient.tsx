"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteVenueAdmin } from "../actions";

type Venue = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  address: string | null;
  postcode: string | null;
  phone: string | null;
  website: string | null;
  image_url: string | null;
  cover_photo_url: string | null;
  logo_url: string | null;
  gallery_image_urls: string[] | null;
  google_photo_url: string | null;
  is_free: boolean;
  price_from: number | null;
  age_min: number | null;
  age_max: number | null;
  setting: string | null;
  venue_type: string | null;
  approved: boolean;
  auto_imported: boolean;
  owner_id: string | null;
  city: { name: string; slug: string } | null;
  categories: { name: string; slug: string }[];
};

type City = { name: string; slug: string; active: boolean };

function photoOf(v: Venue): string | null {
  return (
    v.cover_photo_url ||
    v.image_url ||
    (Array.isArray(v.gallery_image_urls) ? v.gallery_image_urls[0] : null) ||
    v.logo_url ||
    v.google_photo_url ||
    null
  );
}

export default function VenuesManageClient({ venues, cities }: { venues: Venue[]; cities: City[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const [missing, setMissing] = useState<"" | "photo" | "phone" | "website">("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return venues.filter((v) => {
      if (city && v.city?.slug !== city) return false;
      if (missing === "photo" && photoOf(v)) return false;
      if (missing === "phone" && v.phone) return false;
      if (missing === "website" && v.website) return false;
      if (needle && !v.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [venues, q, city, missing]);

  function destroy(v: Venue) {
    if (!confirm(`Delete "${v.name}" permanently?\n\nThis removes the place and all its sessions and tags. Cannot be undone.`)) return;
    setError(null);
    setBusyId(v.id);
    start(async () => {
      const r = await deleteVenueAdmin(v.id);
      setBusyId(null);
      if (r?.error) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center mb-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name…"
          className="input flex-1"
        />
        <select value={city} onChange={(e) => setCity(e.target.value)} className="input sm:w-52">
          <option value="">All areas</option>
          {cities.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}{!c.active ? " (hidden)" : ""}
            </option>
          ))}
        </select>
        <select value={missing} onChange={(e) => setMissing(e.target.value as any)} className="input sm:w-44">
          <option value="">Everything</option>
          <option value="photo">Missing photo</option>
          <option value="phone">Missing phone</option>
          <option value="website">Missing website</option>
        </select>
      </div>

      <p className="text-sm text-buzz-mute mb-4">
        Showing <strong className="text-buzz-text">{filtered.length}</strong> of {venues.length} places.
      </p>
      {error && <div className="text-sm text-rose-400 mb-3">{error}</div>}

      <div className="grid gap-3">
        {filtered.map((v) => {
          const photo = photoOf(v);
          const cat = v.categories[0]?.name;
          const price = v.is_free ? "Free" : v.price_from != null ? `From £${v.price_from}` : null;
          return (
            <div key={v.id} className="card p-3 flex flex-col sm:flex-row gap-3">
              {/* Thumbnail */}
              <div
                className="w-full h-32 sm:w-32 sm:h-24 shrink-0 rounded-lg bg-buzz-surface grid place-items-center overflow-hidden"
                style={photo ? { backgroundImage: `url(${photo})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
              >
                {!photo && <span className="text-2xl opacity-50">🐝</span>}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2 flex-wrap">
                  <h3 className="font-display text-lg uppercase leading-tight">{v.name}</h3>
                  {!v.approved && <span className="text-[10px] uppercase tracking-wide bg-amber-500/15 text-amber-600 px-1.5 py-0.5 rounded">Hidden</span>}
                  {!v.owner_id && v.auto_imported && <span className="text-[10px] uppercase tracking-wide bg-buzz-mute/15 text-buzz-mute px-1.5 py-0.5 rounded">Unclaimed</span>}
                </div>
                <div className="text-xs text-buzz-mute">
                  {v.city?.name ?? "—"}
                  {cat ? ` · ${cat}` : ""}
                  {price ? ` · ${price}` : ""}
                </div>
                {v.description && <p className="text-sm text-buzz-mute line-clamp-2 mt-1">{v.description}</p>}
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs">
                  {v.phone ? (
                    <a href={`tel:${v.phone}`} className="text-buzz-text hover:text-buzz-accent">📞 {v.phone}</a>
                  ) : (
                    <span className="text-buzz-mute/70 italic">no phone</span>
                  )}
                  {v.website ? (
                    <a href={v.website} target="_blank" rel="noreferrer" className="text-buzz-text hover:text-buzz-accent break-all">🌐 {v.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>
                  ) : (
                    <span className="text-buzz-mute/70 italic">no website</span>
                  )}
                  {(v.address || v.postcode) && (
                    <span className="text-buzz-mute">📍 {[v.address, v.postcode].filter(Boolean).join(" · ")}</span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex sm:flex-col gap-2 shrink-0 sm:w-28">
                {v.approved && (
                  <Link href={`/${v.city?.slug ?? "dundee"}/venues/${v.slug}`} target="_blank" className="btn-ghost text-center text-sm flex-1 sm:flex-none">View</Link>
                )}
                <Link href={`/dashboard/venues/${v.id}/edit`} className="btn-secondary text-center text-sm flex-1 sm:flex-none">Edit</Link>
                <button
                  onClick={() => destroy(v)}
                  disabled={pending && busyId === v.id}
                  className="btn-danger text-sm flex-1 sm:flex-none"
                >
                  {pending && busyId === v.id ? "…" : "Delete"}
                </button>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="card p-8 text-center text-buzz-mute">No places match those filters.</div>
        )}
      </div>
    </div>
  );
}
