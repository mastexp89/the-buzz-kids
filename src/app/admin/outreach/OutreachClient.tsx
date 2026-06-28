"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProspect, updateProspect, setProspectStatus, logContact, deleteProspect } from "./actions";

type Prospect = {
  id: string;
  name: string;
  type: string;
  city_id: string | null;
  address: string | null;
  postcode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  notes: string | null;
  status: "not_contacted" | "contacted" | "interested" | "onboarded" | "rejected";
  last_contacted_at: string | null;
};

type City = { id: string; name: string; slug: string };

const STATUSES: Prospect["status"][] = ["not_contacted", "contacted", "interested", "onboarded", "rejected"];

const STATUS_LABEL: Record<Prospect["status"], string> = {
  not_contacted: "Not contacted",
  contacted: "Contacted",
  interested: "Interested",
  onboarded: "Onboarded",
  rejected: "Rejected",
};

const STATUS_CHIP: Record<Prospect["status"], string> = {
  not_contacted: "bg-buzz-surface text-buzz-mute border border-buzz-border",
  contacted: "bg-sky-500/15 text-sky-300 border border-sky-500/40",
  interested: "bg-buzz-accent/15 text-buzz-accent border border-buzz-accent/40",
  onboarded: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40",
  rejected: "bg-rose-500/15 text-rose-300 border border-rose-500/40",
};

const TYPES = ["bar", "pub", "club", "venue", "hotel", "theatre", "restaurant", "other"];

export default function OutreachClient({
  initialProspects,
  cities,
}: {
  initialProspects: Prospect[];
  cities: City[];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [filter, setFilter] = useState<"all" | Prospect["status"]>("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: initialProspects.length };
    for (const s of STATUSES) c[s] = 0;
    for (const p of initialProspects) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [initialProspects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialProspects.filter((p) => {
      if (filter !== "all" && p.status !== filter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.address ?? "").toLowerCase().includes(q) ||
        (p.notes ?? "").toLowerCase().includes(q) ||
        (p.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [initialProspects, filter, search]);

  function action(fn: () => Promise<{ error?: string } | void>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res && (res as any).error) setError((res as any).error);
      else router.refresh();
    });
  }

  const cityName = (id: string | null) => cities.find((c) => c.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-5">
      {error && <div className="card p-3 text-sm text-rose-400 border-rose-500/40">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setFilter("all")} className={filter === "all" ? "chip-accent" : "chip"}>
          All ({counts.all})
        </button>
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={filter === s ? "chip-accent" : "chip"}
          >
            {STATUS_LABEL[s]} ({counts[s] ?? 0})
          </button>
        ))}
        <input
          className="input flex-1 min-w-[200px] max-w-xs ml-auto"
          placeholder="Search name, address, notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button onClick={() => setShowAdd((v) => !v)} className="btn-primary">
          {showAdd ? "Close" : "+ Add prospect"}
        </button>
      </div>

      {showAdd && (
        <AddForm
          cities={cities}
          busy={busy}
          onCancel={() => setShowAdd(false)}
          onSubmit={(fd) => {
            action(async () => {
              const res = await createProspect(fd);
              if (!res?.error) setShowAdd(false);
              return res;
            });
          }}
        />
      )}

      {filtered.length === 0 ? (
        <div className="card p-10 text-center text-buzz-mute">
          {initialProspects.length === 0
            ? "No prospects yet — add your first one."
            : "Nothing matches that filter."}
        </div>
      ) : (
        <ul className="card divide-y divide-buzz-border/60">
          {filtered.map((p) => (
            <ProspectRow
              key={p.id}
              prospect={p}
              cities={cities}
              cityName={cityName}
              isOpen={openId === p.id}
              onToggle={() => setOpenId(openId === p.id ? null : p.id)}
              busy={busy}
              onContacted={() => action(() => logContact(p.id))}
              onStatusChange={(s) => action(() => setProspectStatus(p.id, s))}
              onSave={(fd) => action(() => updateProspect(p.id, fd))}
              onDelete={() => {
                if (confirm(`Delete ${p.name}? This can't be undone.`)) {
                  action(() => deleteProspect(p.id));
                }
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ProspectRow({
  prospect: p,
  cities,
  cityName,
  isOpen,
  onToggle,
  busy,
  onContacted,
  onStatusChange,
  onSave,
  onDelete,
}: {
  prospect: Prospect;
  cities: City[];
  cityName: (id: string | null) => string;
  isOpen: boolean;
  onToggle: () => void;
  busy: boolean;
  onContacted: () => void;
  onStatusChange: (s: Prospect["status"]) => void;
  onSave: (fd: FormData) => void;
  onDelete: () => void;
}) {
  const lastContact = p.last_contacted_at
    ? new Date(p.last_contacted_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <li>
      <div className="p-4 flex flex-wrap items-center gap-3">
        <button onClick={onToggle} className="flex-1 min-w-0 text-left">
          <div className="font-display text-lg uppercase truncate">{p.name}</div>
          <div className="text-xs text-buzz-mute truncate">
            {p.type} · {cityName(p.city_id)}
            {p.phone && <> · 📞 {p.phone}</>}
            {p.email && <> · ✉ {p.email}</>}
            {lastContact && <> · last contact {lastContact}</>}
          </div>
        </button>

        <span className={`text-xs uppercase font-bold tracking-wider px-2.5 py-1 rounded-full ${STATUS_CHIP[p.status]}`}>
          {STATUS_LABEL[p.status]}
        </span>

        <select
          value={p.status}
          disabled={busy}
          onChange={(e) => onStatusChange(e.target.value as Prospect["status"])}
          className="input py-1.5 max-w-[170px]"
          aria-label="Change status"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>

        {p.status === "not_contacted" && (
          <button onClick={onContacted} disabled={busy} className="btn-secondary text-xs">
            Mark contacted
          </button>
        )}

        <button onClick={onToggle} className="btn-secondary text-xs">
          {isOpen ? "Close" : "Edit"}
        </button>
      </div>

      {isOpen && (
        <EditForm
          prospect={p}
          cities={cities}
          busy={busy}
          onSubmit={onSave}
          onDelete={onDelete}
        />
      )}
    </li>
  );
}

function EditForm({
  prospect: p,
  cities,
  busy,
  onSubmit,
  onDelete,
}: {
  prospect: Prospect;
  cities: City[];
  busy: boolean;
  onSubmit: (fd: FormData) => void;
  onDelete: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(new FormData(e.currentTarget));
      }}
      className="border-t border-buzz-border/60 bg-buzz-bg/40 p-5 grid sm:grid-cols-2 gap-3"
    >
      <Field label="Name *">
        <input className="input" name="name" required defaultValue={p.name} />
      </Field>
      <Field label="Type">
        <select className="input" name="type" defaultValue={p.type}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="City">
        <select className="input" name="city_id" defaultValue={p.city_id ?? ""}>
          <option value="">—</option>
          {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Status">
        <select className="input" name="status" defaultValue={p.status}>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </Field>
      <Field label="Address"><input className="input" name="address" defaultValue={p.address ?? ""} /></Field>
      <Field label="Postcode"><input className="input" name="postcode" defaultValue={p.postcode ?? ""} /></Field>
      <Field label="Phone"><input className="input" name="phone" defaultValue={p.phone ?? ""} /></Field>
      <Field label="Email"><input className="input" name="email" type="email" defaultValue={p.email ?? ""} /></Field>
      <Field label="Website"><input className="input" name="website" type="url" defaultValue={p.website ?? ""} placeholder="https://…" /></Field>
      <Field label="Instagram"><input className="input" name="instagram" defaultValue={p.instagram ?? ""} placeholder="https://instagram.com/…" /></Field>
      <Field label="Facebook" wide><input className="input" name="facebook" defaultValue={p.facebook ?? ""} placeholder="https://facebook.com/…" /></Field>
      <Field label="Notes" wide>
        <textarea className="input min-h-[100px]" name="notes" defaultValue={p.notes ?? ""} placeholder="Who you spoke to, what they said, follow-up date, etc." />
      </Field>

      <div className="sm:col-span-2 flex flex-wrap gap-2 mt-1">
        <button type="submit" disabled={busy} className="btn-primary">{busy ? "Saving…" : "Save"}</button>
        <button type="button" onClick={onDelete} disabled={busy} className="btn-danger">Delete</button>
      </div>
    </form>
  );
}

function AddForm({
  cities,
  busy,
  onSubmit,
  onCancel,
}: {
  cities: City[];
  busy: boolean;
  onSubmit: (fd: FormData) => void;
  onCancel: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        onSubmit(fd);
        e.currentTarget.reset();
      }}
      className="card p-5 grid sm:grid-cols-2 gap-3"
    >
      <h2 className="sm:col-span-2 font-display text-xl uppercase">Add prospect</h2>
      <Field label="Name *"><input className="input" name="name" required placeholder="The Buzz Bar" /></Field>
      <Field label="Type">
        <select className="input" name="type" defaultValue="bar">
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="City">
        <select className="input" name="city_id" defaultValue={cities[0]?.id ?? ""}>
          <option value="">—</option>
          {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Postcode"><input className="input" name="postcode" /></Field>
      <Field label="Address" wide><input className="input" name="address" /></Field>
      <Field label="Phone"><input className="input" name="phone" /></Field>
      <Field label="Email"><input className="input" name="email" type="email" /></Field>
      <Field label="Website" wide><input className="input" name="website" type="url" placeholder="https://…" /></Field>
      <Field label="Notes" wide>
        <textarea className="input min-h-[80px]" name="notes" />
      </Field>
      <div className="sm:col-span-2 flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary">{busy ? "Adding…" : "Add prospect"}</button>
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </form>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
