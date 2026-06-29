"use client";

import { useEffect, useState, useTransition } from "react";
import { runLeadsForCategory, leadsToCsv, type Lead } from "./actions";
import { type LeadCategorySlug } from "./categories";

type City = { id: string; name: string; slug: string };
type Category = { slug: LeadCategorySlug; label: string; emoji: string };

// Default outreach copy. Editable in the UI; persisted to localStorage so
// you only ever rewrite it once.
const DEFAULT_SUBJECT = "Quick one for {business} — local advertising on The Buzz Guide";
const DEFAULT_BODY = `Hi {business},

Saw your spot on Google and thought you'd be a great fit for The Buzz Guide — we're a local what's-on guide for {city} (gigs, DJs, sports screenings, nights out), with locals using it every Friday to decide where to go.

We've just started letting local businesses sponsor the site. Three packages from £30/month — homepage banner, in-app placement, social shoutout — rotating between advertisers so you stay visible without being shouted down.

Want me to send over the three options?

Cheers,
Dylan
The Buzz Guide
https://thebuzzguide.co.uk`;

const TEMPLATE_STORAGE_KEY = "thebuzz.leads.template.v1";
const SENDER_STORAGE_KEY = "thebuzz.leads.sender_email.v1";

export default function LeadsClient({
  cities,
  categories,
}: {
  cities: City[];
  categories: Category[];
}) {
  const [citySlug, setCitySlug] = useState(cities[0]?.slug ?? "");
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, Lead[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [costs, setCosts] = useState<Record<string, number>>({});
  const [, startTransition] = useTransition();

  // Outreach template (editable, persisted).
  const [subjectTpl, setSubjectTpl] = useState(DEFAULT_SUBJECT);
  const [bodyTpl, setBodyTpl] = useState(DEFAULT_BODY);
  const [showTemplate, setShowTemplate] = useState(false);

  // Which Gmail / Workspace account to compose from. Without this Gmail
  // opens compose in whatever account is the default browser session —
  // which is usually personal Gmail, so sent mail vanishes from the
  // Workspace Sent folder. Setting it forces /u/{email}/ in the URL.
  const [senderEmail, setSenderEmail] = useState("");

  // Hydrate from localStorage on mount (browser-only).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
      if (raw) {
        const t = JSON.parse(raw);
        if (typeof t.subject === "string") setSubjectTpl(t.subject);
        if (typeof t.body === "string") setBodyTpl(t.body);
      }
      const s = localStorage.getItem(SENDER_STORAGE_KEY);
      if (typeof s === "string") setSenderEmail(s);
    } catch { /* ignore corrupt JSON */ }
  }, []);

  function saveTemplate() {
    try {
      localStorage.setItem(
        TEMPLATE_STORAGE_KEY,
        JSON.stringify({ subject: subjectTpl, body: bodyTpl }),
      );
      localStorage.setItem(SENDER_STORAGE_KEY, senderEmail.trim());
      alert("Saved. Next compose click will use these.");
    } catch {
      alert("Couldn't save (storage full or blocked).");
    }
  }

  function resetTemplate() {
    setSubjectTpl(DEFAULT_SUBJECT);
    setBodyTpl(DEFAULT_BODY);
  }

  function keyFor(cat: string) {
    return `${citySlug}:${cat}`;
  }

  async function runOne(catSlug: LeadCategorySlug) {
    const k = keyFor(catSlug);
    setRunning((s) => new Set(s).add(k));
    setErrors((e) => ({ ...e, [k]: "" }));
    try {
      const r = await runLeadsForCategory(citySlug, catSlug);
      if ("error" in r) {
        setErrors((e) => ({ ...e, [k]: r.error }));
        return;
      }
      setResults((p) => ({ ...p, [k]: r.leads }));
      setCosts((p) => ({ ...p, [k]: r.apifyCost }));
    } catch (err: any) {
      // If the server action itself crashes (function timeout, action file
      // syntax error, anything Next.js bails on) the await rejects with a
      // generic message. Show whatever we can rather than letting the user
      // sit on "Running..." forever.
      const msg =
        err?.message ??
        err?.digest ??
        "Request failed (probably timeout or server crash — check Vercel logs)";
      console.error("[leads] runOne threw", err);
      setErrors((e) => ({ ...e, [k]: msg }));
    } finally {
      setRunning((s) => {
        const n = new Set(s);
        n.delete(k);
        return n;
      });
    }
  }

  async function runAll() {
    for (const cat of categories) {
      await runOne(cat.slug);
    }
  }

  function fillTemplate(text: string, lead: Lead): string {
    return text
      .replaceAll("{business}", lead.name)
      .replaceAll("{city}", lead.city)
      .replaceAll("{category}", lead.category);
  }

  // Gmail compose URL — opens Gmail compose with everything pre-filled.
  // The /u/{email}/ path segment forces Gmail to open the compose window
  // in THAT specific account, regardless of which account is the current
  // default browser session. Without it, users with both personal Gmail
  // AND a Workspace account end up sending from personal by mistake.
  function gmailComposeUrl(lead: Lead) {
    if (!lead.email) return "#";
    const subject = fillTemplate(subjectTpl, lead);
    const body = fillTemplate(bodyTpl, lead);
    const params = new URLSearchParams({
      view: "cm",
      fs: "1",
      to: lead.email,
      su: subject,
      body,
    });
    const accountSegment = senderEmail.trim()
      ? `u/${encodeURIComponent(senderEmail.trim())}/`
      : "";
    return `https://mail.google.com/mail/${accountSegment}?${params.toString()}`;
  }

  async function downloadCityCsv() {
    const allLeads: Lead[] = [];
    for (const cat of categories) {
      const list = results[keyFor(cat.slug)];
      if (list) allLeads.push(...list);
    }
    if (allLeads.length === 0) {
      alert("No leads to export — run some categories first.");
      return;
    }
    const seen = new Set<string>();
    const deduped = allLeads.filter((l) => {
      const k = l.name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const csv = await leadsToCsv(deduped);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `the-buzz-leads-${citySlug}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function totalLeadsForCity() {
    let count = 0;
    for (const cat of categories) {
      const list = results[keyFor(cat.slug)];
      if (list) count += list.length;
    }
    return count;
  }

  function totalCostForCity() {
    let cost = 0;
    for (const cat of categories) {
      const c = costs[keyFor(cat.slug)];
      if (c) cost += c;
    }
    return cost;
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Email template editor */}
      <div className="card p-4">
        <button
          type="button"
          onClick={() => setShowTemplate((v) => !v)}
          className="text-sm font-bold text-buzz-accent flex items-center gap-2"
        >
          ✉️ Email template {showTemplate ? "▴" : "▾"}
        </button>
        {showTemplate && (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-xs text-buzz-mute">
              Used when you click <strong>Compose</strong> on a lead. Placeholders:{" "}
              <code className="bg-buzz-surface px-1 rounded">{"{business}"}</code>,{" "}
              <code className="bg-buzz-surface px-1 rounded">{"{city}"}</code>,{" "}
              <code className="bg-buzz-surface px-1 rounded">{"{category}"}</code>.
              Saved to your browser only — set it once.
            </p>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-buzz-mute font-bold">
                Send from (Gmail / Workspace email)
              </span>
              <input
                type="email"
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
                placeholder="hello@thebuzzkids.co.uk"
                className="input"
              />
              <span className="text-[11px] text-buzz-mute mt-1">
                Forces Gmail to open compose in this account so sent mail lands
                in the right Sent folder. Leave blank to use your default account.
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-buzz-mute font-bold">Subject</span>
              <input
                type="text"
                value={subjectTpl}
                onChange={(e) => setSubjectTpl(e.target.value)}
                className="input"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-buzz-mute font-bold">Body</span>
              <textarea
                value={bodyTpl}
                onChange={(e) => setBodyTpl(e.target.value)}
                rows={12}
                className="input font-mono text-xs"
              />
            </label>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={resetTemplate} className="btn-secondary text-xs">
                Reset to default
              </button>
              <button type="button" onClick={saveTemplate} className="btn-primary text-xs">
                Save template
              </button>
            </div>
          </div>
        )}
      </div>

      {/* City picker + bulk actions */}
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="text-sm font-bold text-buzz-mute">City:</span>
          <select
            value={citySlug}
            onChange={(e) => setCitySlug(e.target.value)}
            className="input !py-1.5 !text-sm max-w-[200px]"
          >
            {cities.map((c) => (
              <option key={c.id} value={c.slug}>{c.name}</option>
            ))}
          </select>
        </label>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => startTransition(runAll)}
          disabled={running.size > 0}
          className="btn-secondary"
        >
          {running.size > 0 ? `Running… (${running.size} active)` : "▶ Run all 8 categories"}
        </button>
        <button
          type="button"
          onClick={downloadCityCsv}
          className="btn-primary"
          disabled={totalLeadsForCity() === 0}
        >
          ⬇ Download {cities.find((c) => c.slug === citySlug)?.name ?? ""} CSV ({totalLeadsForCity()})
        </button>
      </div>

      {totalCostForCity() > 0 && (
        <div className="text-xs text-buzz-mute -mt-2">
          Spent so far on this city: ${totalCostForCity().toFixed(3)} ≈ £
          {(totalCostForCity() * 0.79).toFixed(2)}
        </div>
      )}

      {/* Per-category cards with lead lists */}
      <div className="grid sm:grid-cols-2 gap-3">
        {categories.map((cat) => {
          const k = keyFor(cat.slug);
          const isRunning = running.has(k);
          const list = results[k];
          const err = errors[k];
          return (
            <div key={cat.slug} className="card p-4 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-bold flex items-center gap-2">
                    <span>{cat.emoji}</span>
                    <span className="truncate">{cat.label}</span>
                  </div>
                  {list && (
                    <div className="text-xs text-buzz-mute mt-1">
                      {list.length} found ·{" "}
                      <span className="text-buzz-accent">{list.filter((l) => l.email).length} with email</span>
                    </div>
                  )}
                  {err && (
                    <div className="text-xs text-rose-400 mt-1 break-words">{err}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => runOne(cat.slug)}
                  disabled={isRunning}
                  className="btn-secondary text-xs whitespace-nowrap"
                >
                  {isRunning ? "Running…" : list ? "Re-run" : "Run"}
                </button>
              </div>

              {list && list.length > 0 && (
                <details className="text-xs" open>
                  <summary className="cursor-pointer text-buzz-mute hover:text-buzz-accent">
                    Leads ({list.length})
                  </summary>
                  <div className="mt-2 flex flex-col gap-2 max-h-[320px] overflow-y-auto">
                    {list.map((lead, i) => (
                      <LeadRow
                        key={i}
                        lead={lead}
                        composeUrl={gmailComposeUrl(lead)}
                      />
                    ))}
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LeadRow({ lead, composeUrl }: { lead: Lead; composeUrl: string }) {
  return (
    <div className="border-b border-buzz-border/40 pb-2 last:border-0 flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{lead.name}</div>
        <div className="text-buzz-mute text-[11px] flex flex-wrap gap-x-2">
          {lead.email ? (
            <span className="text-buzz-accent" title={`Source: ${lead.email_source}`}>
              📧 {lead.email}
            </span>
          ) : (
            <span className="opacity-60">no email</span>
          )}
          {lead.phone && <span>📞 {lead.phone}</span>}
          {lead.website && (
            <a
              href={lead.website}
              target="_blank"
              rel="noopener"
              className="hover:text-buzz-accent"
            >
              🌐 website
            </a>
          )}
          {lead.facebook && (
            <a
              href={lead.facebook}
              target="_blank"
              rel="noopener"
              className="hover:text-buzz-accent"
            >
              📘 FB
            </a>
          )}
        </div>
      </div>
      {lead.email ? (
        <a
          href={composeUrl}
          target="_blank"
          rel="noopener"
          className="btn-primary text-[11px] py-1 px-2 whitespace-nowrap"
          title={`Compose email to ${lead.email}`}
        >
          ✉ Compose
        </a>
      ) : (
        <span className="text-[11px] text-buzz-mute italic whitespace-nowrap">
          no email
        </span>
      )}
    </div>
  );
}
