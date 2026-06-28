"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  type LeadCandidate,
  deleteSponsorLead,
  findSponsorLeads,
  saveSponsorLeads,
  setLeadContacted,
  updateLeadNotes,
} from "./actions";

export type SavedLead = {
  id: string;
  name: string;
  fbUrl: string;
  businessType: string | null;
  citySlug: string | null;
  description: string | null;
  notes: string | null;
  contactedAt: string | null;
  createdAt: string;
};

export type CityOption = { name: string; slug: string; active: boolean };

const DEFAULT_TEMPLATE =
  "Hey {businessName} — Dylan from The Buzz Guide here (https://www.thebuzzguide.co.uk). We're a Scottish gig & local-life directory — Tayside-focused but growing. Looking for a couple of local sponsors to feature on our city pages and in the mobile app. Want a quick chat about what that could look like for you?";

const TEMPLATE_STORAGE_KEY = "buzz.sponsorOutreachTemplate.v1";

type FilterContacted = "pending" | "contacted" | "all";

// Same Messenger deep-link logic as venue-outreach. Pages get m.me/<handle>,
// personal profiles or groups fall back to the FB page URL.
function fbMessengerLink(fbUrl: string): { kind: "messenger" | "page"; url: string } {
  try {
    const u = new URL(fbUrl.startsWith("http") ? fbUrl : `https://${fbUrl}`);
    const path = u.pathname.replace(/^\/+|\/+$/g, "");
    if (/^profile\.php/i.test(path)) return { kind: "page", url: fbUrl };
    if (/^groups\//i.test(path)) return { kind: "page", url: fbUrl };
    if (/^p\//i.test(path)) {
      const tail = path.match(/-(\d{6,})$/)?.[1];
      if (tail) return { kind: "messenger", url: `https://m.me/${tail}` };
      return { kind: "page", url: fbUrl };
    }
    const seg = path.split("/")[0];
    if (!seg) return { kind: "page", url: fbUrl };
    if (/^\d{6,}$/.test(seg)) return { kind: "messenger", url: `https://m.me/${seg}` };
    if (/^[a-z0-9.\-]{2,}$/i.test(seg)) return { kind: "messenger", url: `https://m.me/${seg}` };
    return { kind: "page", url: fbUrl };
  } catch {
    return { kind: "page", url: fbUrl };
  }
}

function renderTemplate(tpl: string, lead: SavedLead | LeadCandidate): string {
  const name = "name" in lead ? lead.name : "";
  return tpl.replaceAll("{businessName}", name);
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (sec < 60) return `${sec}s ago`;
  if (min < 60) return `${min}m ago`;
  if (hr < 24) return `${hr}h ago`;
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString("en-GB");
}

export default function SponsorOutreachClient({
  initialLeads,
  cities,
  businessTypes,
  braveConfigured,
}: {
  initialLeads: SavedLead[];
  cities: CityOption[];
  businessTypes: string[];
  braveConfigured: boolean;
}) {
  // ---------- Search panel state ----------
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(
    () => new Set(businessTypes), // default: all presets ticked
  );
  // Default city = first active city, or first city overall.
  const defaultCity = cities.find((c) => c.active)?.slug ?? cities[0]?.slug ?? "";
  const [citySlug, setCitySlug] = useState<string>(defaultCity);
  const [searching, startSearch] = useTransition();
  const [searchError, setSearchError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<LeadCandidate[]>([]);
  const [searchedCity, setSearchedCity] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, startSave] = useTransition();
  const [saveResult, setSaveResult] = useState<string | null>(null);

  // ---------- Saved leads state ----------
  const [leads, setLeads] = useState<SavedLead[]>(initialLeads);
  const [contactedFilter, setContactedFilter] = useState<FilterContacted>("pending");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingNotesFor, setEditingNotesFor] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [, startMisc] = useTransition();

  // Persist template across sessions (same trick as venue-outreach).
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(TEMPLATE_STORAGE_KEY) : null;
    if (saved && saved.length > 0) setTemplate(saved);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(TEMPLATE_STORAGE_KEY, template);
  }, [template]);

  // ---------- Derived ----------
  const counts = useMemo(() => {
    const contacted = leads.filter((l) => !!l.contactedAt).length;
    return { pending: leads.length - contacted, contacted, all: leads.length };
  }, [leads]);

  const visibleLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (contactedFilter === "pending" && l.contactedAt) return false;
      if (contactedFilter === "contacted" && !l.contactedAt) return false;
      if (cityFilter !== "all" && l.citySlug !== cityFilter) return false;
      if (q) {
        const hay = `${l.name} ${l.description ?? ""} ${l.notes ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [leads, contactedFilter, cityFilter, search]);

  // ---------- Actions ----------
  function toggleType(type: string) {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function runSearch() {
    setSearchError(null);
    setSaveResult(null);
    setCandidates([]);
    setPicked(new Set());
    const city = cities.find((c) => c.slug === citySlug);
    if (!city) {
      setSearchError("Pick a city first.");
      return;
    }
    if (selectedTypes.size === 0) {
      setSearchError("Pick at least one business type.");
      return;
    }
    startSearch(async () => {
      const res = await findSponsorLeads({
        businessTypes: Array.from(selectedTypes),
        citySlug: city.slug,
        cityName: city.name,
      });
      if ("error" in res) {
        setSearchError(res.error);
        return;
      }
      setCandidates(res.candidates);
      setSearchedCity(res.cityName);
      // Auto-tick all NEW candidates so the admin can hit "Save" without
      // clicking each box — the ones already saved stay unticked.
      setPicked(new Set(res.candidates.filter((c) => !c.alreadySaved).map((c) => c.fbUrl)));
    });
  }

  function togglePicked(url: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function saveSelected() {
    setSaveResult(null);
    const chosen = candidates.filter((c) => picked.has(c.fbUrl));
    if (chosen.length === 0) {
      setSaveResult("Nothing selected.");
      return;
    }
    // If only one business type is ticked, attribute saved rows to it.
    // Mixed selections save with business_type = null so we don't
    // mis-label e.g. a salon that came up for both "hairdresser" and
    // "beauty salon" queries.
    const onlyType = selectedTypes.size === 1 ? Array.from(selectedTypes)[0] : null;
    startSave(async () => {
      const res = await saveSponsorLeads({
        leads: chosen.map((c) => ({
          name: c.name,
          fbUrl: c.fbUrl,
          description: c.description,
        })),
        businessType: onlyType,
        citySlug: citySlug || null,
      });
      if ("error" in res) {
        setSaveResult(`Error: ${res.error}`);
        return;
      }
      setSaveResult(
        `Saved ${res.inserted} new, ${res.touched} already on file. Reloading…`,
      );
      // Hard reload so the saved-leads list below picks them up via SSR.
      setTimeout(() => window.location.reload(), 800);
    });
  }

  async function copyForLead(lead: SavedLead | LeadCandidate, id: string) {
    const text = renderTemplate(template, lead);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1800);
    } catch {
      alert(text);
    }
  }

  function toggleContacted(lead: SavedLead) {
    const next = !lead.contactedAt;
    setBusyId(lead.id);
    setLeads((ls) =>
      ls.map((l) => (l.id === lead.id ? { ...l, contactedAt: next ? new Date().toISOString() : null } : l)),
    );
    startMisc(async () => {
      const res = await setLeadContacted(lead.id, next);
      if ("error" in res) {
        alert(`Couldn't update: ${res.error}`);
        setLeads((ls) =>
          ls.map((l) => (l.id === lead.id ? { ...l, contactedAt: lead.contactedAt } : l)),
        );
      } else {
        setLeads((ls) =>
          ls.map((l) => (l.id === lead.id ? { ...l, contactedAt: res.at } : l)),
        );
      }
      setBusyId(null);
    });
  }

  function startEditNotes(lead: SavedLead) {
    setEditingNotesFor(lead.id);
    setNotesDraft(lead.notes ?? "");
  }

  function saveNotes(lead: SavedLead) {
    const draft = notesDraft;
    setEditingNotesFor(null);
    setLeads((ls) => ls.map((l) => (l.id === lead.id ? { ...l, notes: draft.trim() || null } : l)));
    startMisc(async () => {
      const res = await updateLeadNotes(lead.id, draft);
      if ("error" in res) alert(`Couldn't save notes: ${res.error}`);
    });
  }

  function deleteRow(lead: SavedLead) {
    if (!confirm(`Delete "${lead.name}" from outreach?`)) return;
    setBusyId(lead.id);
    setLeads((ls) => ls.filter((l) => l.id !== lead.id));
    startMisc(async () => {
      const res = await deleteSponsorLead(lead.id);
      if ("error" in res) {
        alert(`Couldn't delete: ${res.error}`);
        setLeads((ls) => [lead, ...ls]);
      }
      setBusyId(null);
    });
  }

  function openMessenger(fbUrl: string, ev: React.MouseEvent) {
    const link = fbMessengerLink(fbUrl);
    if (link.kind === "page") {
      ev.preventDefault();
      window.open(link.url, "_blank", "noopener,noreferrer");
    }
  }

  // ---------- Render ----------
  return (
    <>
      {/* Search panel */}
      <section className="card p-4 mb-6">
        <h2 className="font-medium mb-3">🔍 Find new leads</h2>
        <div className="flex flex-wrap gap-2 mb-3">
          {businessTypes.map((t) => (
            <label
              key={t}
              className={
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm cursor-pointer transition " +
                (selectedTypes.has(t)
                  ? "bg-buzz-accent text-buzz-bg"
                  : "bg-buzz-card text-buzz-mute hover:text-buzz-fg border border-buzz-border")
              }
            >
              <input
                type="checkbox"
                checked={selectedTypes.has(t)}
                onChange={() => toggleType(t)}
                className="sr-only"
              />
              {t}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={citySlug}
            onChange={(e) => setCitySlug(e.target.value)}
            className="input min-w-[180px]"
          >
            {cities.length === 0 && <option value="">(no cities)</option>}
            {cities.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
                {!c.active ? " (hidden)" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={runSearch}
            disabled={searching || !braveConfigured}
            className="btn-primary"
          >
            {searching ? "Searching…" : "Find leads"}
          </button>
          <span className="text-xs text-buzz-mute">
            ~1s per business type ticked.
          </span>
        </div>
        {searchError && (
          <p className="text-sm text-rose-400 mt-3">{searchError}</p>
        )}

        {candidates.length > 0 && (
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <p className="text-sm text-buzz-mute">
                {candidates.length} result{candidates.length === 1 ? "" : "s"} for{" "}
                <strong className="text-buzz-fg">{searchedCity}</strong> ·{" "}
                {candidates.filter((c) => c.alreadySaved).length} already saved
              </p>
              <div className="flex-1" />
              <button
                type="button"
                onClick={saveSelected}
                disabled={saving || picked.size === 0}
                className="btn-primary text-sm"
              >
                {saving ? "Saving…" : `Save selected (${picked.size})`}
              </button>
            </div>
            {saveResult && (
              <p
                className={
                  "text-sm mb-2 " +
                  (saveResult.startsWith("Error") ? "text-rose-400" : "text-emerald-400")
                }
              >
                {saveResult}
              </p>
            )}
            <ul className="divide-y divide-buzz-border/60">
              {candidates.map((c) => {
                const checked = picked.has(c.fbUrl);
                return (
                  <li
                    key={c.fbUrl}
                    className={
                      "flex items-start gap-3 py-2 " +
                      (c.alreadySaved ? "opacity-60" : "")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePicked(c.fbUrl)}
                      disabled={c.alreadySaved}
                      className="mt-1 accent-buzz-accent"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium truncate">{c.name}</span>
                        {c.alreadySaved && (
                          <span className="text-[10px] uppercase tracking-wide text-buzz-mute shrink-0">
                            already saved
                          </span>
                        )}
                      </div>
                      {c.description && (
                        <div className="text-xs text-buzz-mute truncate">{c.description}</div>
                      )}
                      <a
                        href={c.fbUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-buzz-mute hover:text-buzz-accent truncate inline-block"
                      >
                        {c.fbUrl} ↗
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {/* Message template */}
      <details className="card p-4 mb-4 group" open={editingTemplate}>
        <summary
          className="cursor-pointer list-none flex items-center justify-between gap-3"
          onClick={(e) => {
            e.preventDefault();
            setEditingTemplate((s) => !s);
          }}
        >
          <div>
            <div className="font-medium text-sm">📝 Sponsorship pitch template</div>
            <div className="text-xs text-buzz-mute">
              Edit once, saved locally. Use <code className="text-buzz-accent">{"{businessName}"}</code> as a merge field.
            </div>
          </div>
          <span className="text-xs text-buzz-mute shrink-0">
            {editingTemplate ? "Hide" : "Edit"}
          </span>
        </summary>
        {editingTemplate && (
          <textarea
            className="input mt-3 min-h-[120px] font-mono text-sm"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            spellCheck={false}
          />
        )}
      </details>

      {/* Saved leads list */}
      <section>
        <div className="flex flex-wrap gap-3 items-center mb-4">
          <div className="flex gap-1">
            {(["pending", "contacted", "all"] as FilterContacted[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setContactedFilter(f)}
                className={
                  "px-3 py-1.5 rounded-full text-sm transition " +
                  (contactedFilter === f
                    ? "bg-buzz-accent text-buzz-bg font-medium"
                    : "bg-buzz-card text-buzz-mute hover:text-buzz-fg")
                }
              >
                {f === "pending" && `Not contacted (${counts.pending})`}
                {f === "contacted" && `Contacted (${counts.contacted})`}
                {f === "all" && `All (${counts.all})`}
              </button>
            ))}
          </div>
          <select
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            className="input"
          >
            <option value="all">All cities</option>
            {cities.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            type="search"
            placeholder="Search saved leads…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input flex-1 min-w-[200px]"
          />
        </div>

        {visibleLeads.length === 0 ? (
          <div className="card p-8 text-center text-buzz-mute">
            {leads.length === 0
              ? "No leads yet — run a search above to get started."
              : "No saved leads match this filter."}
          </div>
        ) : (
          <ul className="card divide-y divide-buzz-border/60">
            {visibleLeads.map((l) => {
              const link = fbMessengerLink(l.fbUrl);
              const isMessenger = link.kind === "messenger";
              const isEditingNotes = editingNotesFor === l.id;
              return (
                <li key={l.id} className="p-3 sm:p-4 flex flex-col gap-2">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{l.name}</div>
                      <div className="text-xs text-buzz-mute truncate">
                        {l.businessType ?? "—"}
                        {l.citySlug ? ` · ${l.citySlug}` : ""}
                        {" · "}
                        <a
                          href={l.fbUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-buzz-accent"
                        >
                          page ↗
                        </a>
                        {l.contactedAt && (
                          <> · <span className="text-emerald-400">contacted {timeAgo(l.contactedAt)}</span></>
                        )}
                      </div>
                      {l.description && !isEditingNotes && (
                        <div className="text-xs text-buzz-mute italic truncate mt-0.5">
                          {l.description}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => openMessenger(l.fbUrl, e)}
                        className="btn-secondary text-xs px-3 py-1.5"
                        title={isMessenger ? "Opens Messenger to this page" : "Opens the FB page — click Message once inside"}
                      >
                        {isMessenger ? "📩 Messenger" : "📄 Open page"}
                      </a>
                      <button
                        type="button"
                        onClick={() => copyForLead(l, l.id)}
                        className="btn-ghost text-xs px-3 py-1.5"
                        title="Copy the personalised pitch to clipboard"
                      >
                        {copiedId === l.id ? "✓ Copied" : "📋 Copy"}
                      </button>
                      <label
                        className={
                          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs cursor-pointer select-none transition " +
                          (l.contactedAt
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-buzz-card text-buzz-mute hover:text-buzz-fg")
                        }
                      >
                        <input
                          type="checkbox"
                          checked={!!l.contactedAt}
                          onChange={() => toggleContacted(l)}
                          disabled={busyId === l.id}
                          className="accent-buzz-accent"
                        />
                        {l.contactedAt ? "Contacted" : "Mark contacted"}
                      </label>
                      <button
                        type="button"
                        onClick={() => deleteRow(l)}
                        className="btn-ghost text-xs px-2 py-1.5 text-rose-400/70 hover:text-rose-400"
                        title="Delete this lead"
                        disabled={busyId === l.id}
                      >
                        🗑
                      </button>
                    </div>
                  </div>

                  {/* Notes — collapsed by default, click to edit */}
                  {isEditingNotes ? (
                    <div className="flex flex-col gap-2 mt-1">
                      <textarea
                        value={notesDraft}
                        onChange={(e) => setNotesDraft(e.target.value)}
                        className="input min-h-[60px] text-sm"
                        placeholder="e.g. 'said maybe in May', 'follow up after holidays'"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => saveNotes(l)}
                          className="btn-primary text-xs"
                        >
                          Save notes
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingNotesFor(null)}
                          className="btn-ghost text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEditNotes(l)}
                      className="text-xs text-left text-buzz-mute hover:text-buzz-accent transition w-full"
                    >
                      {l.notes ? (
                        <>📝 <span className="italic">{l.notes}</span></>
                      ) : (
                        <span className="opacity-60">+ Add notes</span>
                      )}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-xs text-buzz-mute mt-4">
          Tip: open Messenger, click 📋 Copy here, paste, send, tick contacted.
          Notes are for your own reference — &quot;said maybe in May&quot;, &quot;follow up&quot;,
          &quot;not interested&quot;. Personal-account messaging from your own FB stays
          fully within Facebook&apos;s ToS — no automation here.
        </p>
      </section>
    </>
  );
}
