"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import ImageUploader from "@/components/ImageUploader";
import {
  createSponsor,
  updateSponsor,
  pauseSponsor,
  resumeSponsor,
  expireSponsor,
  extendSponsor,
  deleteSponsor,
  type SponsorRow,
  type SponsorTier,
  type SponsorStatus,
} from "./actions";

type City = { id: string; name: string; slug: string };

const TIER_LABEL: Record<SponsorTier, string> = {
  starter: "Starter (£30)",
  popular: "Popular (£60)",
  premium: "Premium (£100)",
};

const CATEGORY_OPTIONS = [
  { value: "takeaway", label: "Takeaway" },
  { value: "restaurant", label: "Restaurant" },
  { value: "taxi", label: "Taxi" },
  { value: "hairdresser", label: "Hairdresser" },
  { value: "barber", label: "Barber" },
  { value: "services", label: "Services" },
  { value: "retail", label: "Retail" },
  { value: "leisure", label: "Leisure" },
  { value: "other", label: "Other" },
];

export default function SponsorsListClient({
  initialSponsors,
  cities,
}: {
  initialSponsors: SponsorRow[];
  cities: City[];
}) {
  const [sponsors, setSponsors] = useState(initialSponsors);
  const [showCreate, setShowCreate] = useState(initialSponsors.length === 0);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Group rows by status so the live ones are at the top.
  const grouped = useMemo(() => {
    const active = sponsors.filter((s) => s.status === "active");
    const paused = sponsors.filter((s) => s.status === "paused");
    const expired = sponsors.filter((s) => s.status === "expired");
    return { active, paused, expired };
  }, [sponsors]);

  function upsertLocal(row: SponsorRow) {
    setSponsors((prev) => {
      const idx = prev.findIndex((s) => s.id === row.id);
      if (idx === -1) return [row, ...prev];
      const next = [...prev];
      next[idx] = row;
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {!showCreate && (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="btn-primary self-start"
        >
          + New sponsor
        </button>
      )}

      {showCreate && (
        <SponsorForm
          cities={cities}
          onCancel={() => setShowCreate(false)}
          onSaved={(row) => {
            upsertLocal(row);
            setShowCreate(false);
          }}
        />
      )}

      {sponsors.length === 0 && !showCreate && (
        <div className="card p-8 text-center text-buzz-mute">
          No sponsors yet. Click <strong>New sponsor</strong> to add the first.
        </div>
      )}

      {grouped.active.length > 0 && (
        <Section title="Live" tone="emerald">
          {grouped.active.map((s) => (
            <SponsorRowItem
              key={s.id}
              sponsor={s}
              cities={cities}
              editing={editingId === s.id}
              onEdit={() => setEditingId(s.id)}
              onCancelEdit={() => setEditingId(null)}
              onSaved={(row) => {
                upsertLocal(row);
                setEditingId(null);
              }}
              onRemove={(id) => setSponsors((p) => p.filter((x) => x.id !== id))}
            />
          ))}
        </Section>
      )}

      {grouped.paused.length > 0 && (
        <Section title="Paused" tone="amber">
          {grouped.paused.map((s) => (
            <SponsorRowItem
              key={s.id}
              sponsor={s}
              cities={cities}
              editing={editingId === s.id}
              onEdit={() => setEditingId(s.id)}
              onCancelEdit={() => setEditingId(null)}
              onSaved={(row) => {
                upsertLocal(row);
                setEditingId(null);
              }}
              onRemove={(id) => setSponsors((p) => p.filter((x) => x.id !== id))}
            />
          ))}
        </Section>
      )}

      {grouped.expired.length > 0 && (
        <Section title="Expired" tone="mute">
          {grouped.expired.map((s) => (
            <SponsorRowItem
              key={s.id}
              sponsor={s}
              cities={cities}
              editing={editingId === s.id}
              onEdit={() => setEditingId(s.id)}
              onCancelEdit={() => setEditingId(null)}
              onSaved={(row) => {
                upsertLocal(row);
                setEditingId(null);
              }}
              onRemove={(id) => setSponsors((p) => p.filter((x) => x.id !== id))}
            />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "emerald" | "amber" | "mute";
  children: React.ReactNode;
}) {
  const color =
    tone === "emerald" ? "text-emerald-400"
    : tone === "amber" ? "text-amber-400"
    : "text-buzz-mute";
  return (
    <div className="flex flex-col gap-2">
      <h2 className={`eyebrow text-xs ${color}`}>{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function SponsorRowItem({
  sponsor,
  cities,
  editing,
  onEdit,
  onCancelEdit,
  onSaved,
  onRemove,
}: {
  sponsor: SponsorRow;
  cities: City[];
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaved: (row: SponsorRow) => void;
  onRemove: (id: string) => void;
}) {
  const [pending, startTransition] = useTransition();

  if (editing) {
    return (
      <SponsorForm
        cities={cities}
        existing={sponsor}
        onCancel={onCancelEdit}
        onSaved={onSaved}
      />
    );
  }

  const startsAtDate = new Date(sponsor.starts_at);
  const endsAtDate = new Date(sponsor.ends_at);
  const now = Date.now();
  const daysLeft = Math.max(0, Math.ceil((endsAtDate.getTime() - now) / 86400000));
  const expiringSoon = sponsor.status === "active" && daysLeft <= 7;

  return (
    <div className="card p-4 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        {sponsor.image_url ? (
          <div
            className="w-16 h-16 rounded-lg bg-buzz-surface shrink-0 border border-buzz-border"
            style={{
              backgroundImage: `url(${sponsor.image_url})`,
              backgroundSize: "contain",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
              backgroundColor: "#000",
            }}
          />
        ) : (
          <div className="w-16 h-16 rounded-lg bg-buzz-surface border border-buzz-border grid place-items-center text-2xl shrink-0">📦</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="h-display text-xl truncate">{sponsor.name}</h3>
            <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-buzz-surface text-buzz-mute">
              {TIER_LABEL[sponsor.tier]}
            </span>
            {expiringSoon && (
              <span className="text-[10px] uppercase tracking-wider font-bold text-amber-400">
                {daysLeft === 0 ? "expires today" : `${daysLeft}d left`}
              </span>
            )}
          </div>
          <div className="text-xs text-buzz-mute mt-1">
            {sponsor.city_name ?? "Nationwide"}
            {sponsor.category ? ` · ${sponsor.category}` : ""}
            {" · "}
            {formatDate(startsAtDate)} → {formatDate(endsAtDate)}
            {sponsor.monthly_price ? ` · £${Number(sponsor.monthly_price).toFixed(2)}/mo` : ""}
          </div>
          {sponsor.blurb && (
            <div className="text-sm text-buzz-mute mt-1 italic">"{sponsor.blurb}"</div>
          )}
          <div className="text-xs text-buzz-mute mt-1">
            → <a href={sponsor.link_url} target="_blank" className="text-buzz-accent hover:underline truncate">{sponsor.link_url}</a>
          </div>
          <div className="text-xs text-buzz-mute mt-1">
            👁 {sponsor.impression_count.toLocaleString()} impressions ·
            👆 {sponsor.click_count.toLocaleString()} clicks
            {sponsor.impression_count > 0 && (
              <> · CTR {((sponsor.click_count / sponsor.impression_count) * 100).toFixed(2)}%</>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-end gap-2 shrink-0">
        <div className="flex gap-2 flex-wrap justify-end">
          <button type="button" onClick={onEdit} className="btn-secondary text-xs">Edit</button>
          {sponsor.status === "active" && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await pauseSponsor(sponsor.id);
                  if ("error" in r) alert(r.error);
                  else onSaved({ ...sponsor, status: "paused" });
                })
              }
              className="btn-secondary text-xs"
            >
              Pause
            </button>
          )}
          {sponsor.status === "paused" && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await resumeSponsor(sponsor.id);
                  if ("error" in r) alert(r.error);
                  else onSaved({ ...sponsor, status: "active" });
                })
              }
              className="btn-secondary text-xs"
            >
              Resume
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!confirm(`Extend "${sponsor.name}" by another 30 days?`)) return;
              startTransition(async () => {
                const r = await extendSponsor(sponsor.id, 30);
                if ("error" in r) alert(r.error);
                else onSaved({ ...sponsor, status: "active", ends_at: r.newEndsAt });
              });
            }}
            className="btn-secondary text-xs"
          >
            +30d
          </button>
          {sponsor.status !== "expired" && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!confirm(`Expire "${sponsor.name}" now? They'll stop appearing immediately.`)) return;
                startTransition(async () => {
                  const r = await expireSponsor(sponsor.id);
                  if ("error" in r) alert(r.error);
                  else onSaved({ ...sponsor, status: "expired" });
                });
              }}
              className="text-xs text-amber-400 hover:text-amber-300 px-2"
            >
              Expire
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!confirm(`Delete "${sponsor.name}" permanently? This can't be undone.`)) return;
              startTransition(async () => {
                const r = await deleteSponsor(sponsor.id);
                if ("error" in r) alert(r.error);
                else onRemove(sponsor.id);
              });
            }}
            className="text-xs text-rose-400 hover:text-rose-300 px-2"
          >
            Delete
          </button>
        </div>
        <Link
          href={`/sponsors/${sponsor.slug}`}
          target="_blank"
          className="text-xs text-buzz-mute hover:text-buzz-accent"
        >
          View public page ↗
        </Link>
      </div>
    </div>
  );
}

function SponsorForm({
  existing,
  cities,
  onCancel,
  onSaved,
}: {
  existing?: SponsorRow;
  cities: City[];
  onCancel: () => void;
  onSaved: (row: SponsorRow) => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [tier, setTier] = useState<SponsorTier>(existing?.tier ?? "popular");
  const [cityId, setCityId] = useState<string>(existing?.city_id ?? cities[0]?.id ?? "");
  const [category, setCategory] = useState(existing?.category ?? "takeaway");
  const [imageUrl, setImageUrl] = useState(existing?.image_url ?? "");
  const [linkUrl, setLinkUrl] = useState(existing?.link_url ?? "");
  const [blurb, setBlurb] = useState(existing?.blurb ?? "");
  const [price, setPrice] = useState(
    existing?.monthly_price?.toString() ??
      (existing?.tier === "starter" ? "30" : existing?.tier === "premium" ? "100" : "60"),
  );
  const [startsAt, setStartsAt] = useState(
    existing?.starts_at ? existing.starts_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
  );
  const [endsAt, setEndsAt] = useState(
    existing?.ends_at
      ? existing.ends_at.slice(0, 10)
      : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  );
  const [status, setStatus] = useState<SponsorStatus>(existing?.status ?? "active");
  // Default new sponsors to show on app — admins explicitly untick when
  // the sponsor's reach is web-only (typically backlink-only Premium deals).
  const [showOnApp, setShowOnApp] = useState<boolean>(existing?.show_on_app ?? true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const payload = {
      name: name.trim(),
      tier,
      city_id: cityId || null,
      category: category || null,
      image_url: imageUrl || undefined,
      link_url: linkUrl.trim(),
      blurb: blurb.trim() || undefined,
      monthly_price: price ? Number(price) : null,
      starts_at: startsAt,
      ends_at: endsAt,
    };

    let r;
    if (existing) {
      r = await updateSponsor(existing.id, { ...payload, status, show_on_app: showOnApp });
    } else {
      r = await createSponsor(payload);
      // createSponsor defaults show_on_app=true server-side; if admin
      // ticked it off pre-create, flip via update right after.
      if (!("error" in r) && !showOnApp) {
        await updateSponsor(r.id, { show_on_app: false });
      }
    }
    setBusy(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }

    const cityRow = cities.find((c) => c.id === cityId) ?? null;
    const updated: SponsorRow = {
      id: existing?.id ?? (r as any).id,
      name: payload.name,
      slug: existing?.slug ?? (r as any).slug,
      tier,
      city_id: cityId || null,
      city_name: cityRow?.name ?? null,
      city_slug: cityRow?.slug ?? null,
      category: payload.category,
      image_url: imageUrl || null,
      link_url: payload.link_url,
      blurb: payload.blurb ?? null,
      status,
      starts_at: new Date(startsAt).toISOString(),
      ends_at: new Date(endsAt).toISOString(),
      monthly_price: payload.monthly_price,
      impression_count: existing?.impression_count ?? 0,
      click_count: existing?.click_count ?? 0,
      show_on_app: showOnApp,
      created_at: existing?.created_at ?? new Date().toISOString(),
    };
    onSaved(updated);
  }

  return (
    <form onSubmit={submit} className="card p-5 flex flex-col gap-4">
      <h2 className="h-display text-2xl">{existing ? "Edit sponsor" : "New sponsor"}</h2>

      <Field label="Business name">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Dundee Scoff"
          className="input w-full"
        />
      </Field>

      <Field label="Logo / banner image">
        <ImageUploader folder="sponsors" value={imageUrl} onChange={setImageUrl} maxDimension={1200} />
      </Field>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Tier">
          <select
            value={tier}
            onChange={(e) => {
              const v = e.target.value as SponsorTier;
              setTier(v);
              if (!existing) setPrice(v === "starter" ? "30" : v === "premium" ? "100" : "60");
            }}
            className="input w-full"
          >
            <option value="starter">Starter — £30/mo</option>
            <option value="popular">Popular — £60/mo</option>
            <option value="premium">Premium — £100/mo</option>
          </select>
        </Field>
        <Field label="Monthly price (£)">
          <input
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="input w-full"
          />
        </Field>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Target city">
          <select value={cityId} onChange={(e) => setCityId(e.target.value)} className="input w-full">
            <option value="">Nationwide (all cities)</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="input w-full">
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Click-through URL">
        <input
          type="url"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          required
          placeholder="https://dundeescoff.co.uk/"
          className="input w-full"
        />
      </Field>

      <Field label="Slogan / blurb (1 line, ≤200 chars)">
        <input
          type="text"
          value={blurb}
          onChange={(e) => setBlurb(e.target.value)}
          maxLength={200}
          placeholder="Gotta Roll With It"
          className="input w-full"
        />
      </Field>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Starts">
          <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required className="input w-full" />
        </Field>
        <Field label="Ends">
          <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required className="input w-full" />
        </Field>
      </div>

      {existing && (
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value as SponsorStatus)} className="input w-full">
            <option value="active">Active — showing on site</option>
            <option value="paused">Paused — hidden, will not show</option>
            <option value="expired">Expired — finished, archived</option>
          </select>
        </Field>
      )}

      <label className="card p-3 flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={showOnApp}
          onChange={(e) => setShowOnApp(e.target.checked)}
          className="mt-1 cursor-pointer"
        />
        <div className="flex-1">
          <div className="font-medium text-sm">📱 Show on mobile app</div>
          <p className="text-xs text-buzz-mute mt-1">
            Tick to display this sponsor in the app&apos;s <strong>Locals</strong> tab as well
            as the web. Untick when the sponsor only paid for web reach.
          </p>
        </div>
      </label>

      {error && (
        <div className="card border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="btn-secondary" disabled={busy}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : existing ? "Save changes" : "Create sponsor"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-buzz-mute uppercase tracking-wider font-bold">{label}</span>
      {children}
    </label>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
