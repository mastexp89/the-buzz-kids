"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createVenueAsAdmin } from "./actions";

type City = { id: string; name: string; slug: string; active: boolean };

export default function NewVenueForm({ cities }: { cities: City[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Default to the first ACTIVE city — hidden cities (e.g. Fife while
  // it's being populated) are still in the dropdown but not the default
  // pick. If there are no active cities at all, fall back to whatever's
  // first in the list.
  const defaultCityId =
    cities.find((c) => c.active)?.id ?? cities[0]?.id ?? "";
  const [form, setForm] = useState({
    name: "",
    cityId: defaultCityId,
    address: "",
    postcode: "",
    facebook: "",
    website: "",
    phone: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    venueSlug: string;
    citySlug: string;
    geocoded: boolean;
  } | null>(null);

  function field<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
    setError(null);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!form.cityId) {
      setError("Pick a city.");
      return;
    }
    start(async () => {
      const r = await createVenueAsAdmin({
        name: form.name,
        cityId: form.cityId,
        address: form.address || undefined,
        postcode: form.postcode || undefined,
        facebook: form.facebook || undefined,
        website: form.website || undefined,
        phone: form.phone || undefined,
      });
      if ("error" in r) {
        setError(r.error);
        return;
      }
      setSuccess({
        venueSlug: r.venueSlug,
        citySlug: r.citySlug,
        geocoded: r.geocoded,
      });
      router.refresh();
    });
  }

  if (success) {
    return (
      <div className="card p-6 border-emerald-500/40 bg-emerald-500/5">
        <h2 className="h-display text-2xl mb-2">✓ Venue created</h2>
        <p className="text-sm text-buzz-mute mb-4">
          <strong className="text-buzz-text">{form.name}</strong> is now live
          on the site.
          {success.geocoded
            ? " Postcode geocoded successfully — it has map coordinates."
            : " No coordinates yet — add a postcode later if you want it pinned on the map."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/${success.citySlug}/venues/${success.venueSlug}`}
            target="_blank"
            className="btn-primary text-sm"
          >
            View venue ↗
          </Link>
          <button
            type="button"
            onClick={() => {
              setSuccess(null);
              setForm({
                name: "",
                cityId: form.cityId, // remember the city for fast bulk-adding
                address: "",
                postcode: "",
                facebook: "",
                website: "",
                phone: "",
              });
            }}
            className="btn-secondary text-sm"
          >
            Add another venue
          </button>
          <Link href="/admin" className="btn-ghost text-sm">
            Back to admin
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card p-5 flex flex-col gap-4">
      <div>
        <label className="label">Name *</label>
        <input
          className="input"
          value={form.name}
          onChange={(e) => field("name", e.target.value)}
          placeholder="The Hidden Gem"
          autoFocus
          required
          maxLength={200}
        />
      </div>

      <div>
        <label className="label">City / region *</label>
        <select
          className="input"
          value={form.cityId}
          onChange={(e) => field("cityId", e.target.value)}
          required
        >
          {cities.length === 0 && <option value="">(no cities)</option>}
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {!c.active ? " (hidden)" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Address</label>
          <input
            className="input"
            value={form.address}
            onChange={(e) => field("address", e.target.value)}
            placeholder="12 High Street"
          />
        </div>
        <div>
          <label className="label">Postcode</label>
          <input
            className="input"
            value={form.postcode}
            onChange={(e) => field("postcode", e.target.value)}
            placeholder="DD1 1AA"
            // No pattern enforcement — postcodes.io will validate it later.
          />
          <p className="help">UK postcode → auto-geocoded for the map pin.</p>
        </div>
      </div>

      <div>
        <label className="label">Facebook URL</label>
        <input
          className="input"
          type="url"
          value={form.facebook}
          onChange={(e) => field("facebook", e.target.value)}
          placeholder="https://facebook.com/thehiddengem"
        />
        <p className="help">
          If set, the venue gets picked up by the FB scrape cron going forward.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Website</label>
          <input
            className="input"
            type="url"
            value={form.website}
            onChange={(e) => field("website", e.target.value)}
            placeholder="https://thehiddengem.co.uk"
          />
        </div>
        <div>
          <label className="label">Phone</label>
          <input
            className="input"
            type="tel"
            value={form.phone}
            onChange={(e) => field("phone", e.target.value)}
            placeholder="01234 567890"
          />
        </div>
      </div>

      {error && <div className="text-sm text-rose-400">{error}</div>}

      <div className="flex gap-2 items-center">
        <button
          type="submit"
          disabled={pending || !form.name.trim()}
          className="btn-primary"
        >
          {pending ? "Creating…" : "Create venue"}
        </button>
        <Link href="/admin" className="btn-ghost text-sm">
          Cancel
        </Link>
      </div>
    </form>
  );
}
