"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { setVenueMessaged } from "./actions";

export type OutreachRow = {
  id: string;
  name: string;
  slug: string | null;
  facebook: string;
  cityName: string | null;
  citySlug: string | null;
  messagedAt: string | null;
};

const DEFAULT_TEMPLATE =
  "Hey {venueName} — Dylan from The Buzz Guide here. We're a free directory for live music & nights out across Tayside (https://www.thebuzzguide.co.uk). Your venue is already listed but unclaimed — want me to hand it over so you can manage your gigs, photos and promotions yourself? Takes 60 seconds: {claimLink}";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://www.thebuzzguide.co.uk";
const TEMPLATE_STORAGE_KEY = "buzz.outreachTemplate.v1";

type Filter = "pending" | "done" | "all";

/**
 * Build a Messenger deep link from a venue's FB URL, when possible.
 *
 * Returns:
 *   { kind: "messenger", url } — opens Messenger directly to the page.
 *   { kind: "page", url }      — only the page URL is usable; admin still
 *                                has to click "Message" once inside.
 */
function fbMessengerLink(fbUrl: string): { kind: "messenger" | "page"; url: string } {
  try {
    const u = new URL(fbUrl.startsWith("http") ? fbUrl : `https://${fbUrl}`);
    const path = u.pathname.replace(/^\/+|\/+$/g, "");
    // profile.php?id=... is a personal-profile URL, not a page — Messenger
    // won't open a personal profile via m.me, so fall back to the page.
    if (/^profile\.php/i.test(path)) return { kind: "page", url: fbUrl };
    // Groups can't be messaged.
    if (/^groups\//i.test(path)) return { kind: "page", url: fbUrl };
    // "/p/Some-Page-100012345" — try the trailing numeric ID, otherwise fall back.
    if (/^p\//i.test(path)) {
      const tail = path.match(/-(\d{6,})$/)?.[1];
      if (tail) return { kind: "messenger", url: `https://m.me/${tail}` };
      return { kind: "page", url: fbUrl };
    }
    // First path segment is usually the page handle (or numeric page ID).
    const seg = path.split("/")[0];
    if (!seg) return { kind: "page", url: fbUrl };
    if (/^\d{6,}$/.test(seg)) return { kind: "messenger", url: `https://m.me/${seg}` };
    if (/^[a-z0-9.-]{2,}$/i.test(seg)) return { kind: "messenger", url: `https://m.me/${seg}` };
    return { kind: "page", url: fbUrl };
  } catch {
    return { kind: "page", url: fbUrl };
  }
}

function renderTemplate(tpl: string, row: OutreachRow): string {
  const claimLink = row.citySlug && row.slug
    ? `${SITE}/${row.citySlug}/venues/${row.slug}`
    : SITE;
  return tpl
    .replaceAll("{venueName}", row.name)
    .replaceAll("{claimLink}", claimLink);
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

export default function VenueOutreachClient({ initialRows }: { initialRows: OutreachRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState<Filter>("pending");
  const [search, setSearch] = useState("");
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Persist the template across reloads — the admin shouldn't have to
  // re-type their preferred wording every session.
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(TEMPLATE_STORAGE_KEY) : null;
    if (saved && saved.length > 0) setTemplate(saved);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(TEMPLATE_STORAGE_KEY, template);
  }, [template]);

  const counts = useMemo(() => {
    const done = rows.filter((r) => !!r.messagedAt).length;
    return { pending: rows.length - done, done, all: rows.length };
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "pending" && r.messagedAt) return false;
      if (filter === "done" && !r.messagedAt) return false;
      if (q && !r.name.toLowerCase().includes(q) && !(r.cityName ?? "").toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [rows, filter, search]);

  async function copyForRow(row: OutreachRow) {
    const text = renderTemplate(template, row);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(row.id);
      setTimeout(() => setCopiedId((id) => (id === row.id ? null : id)), 1800);
    } catch {
      // Fallback for old browsers / non-https — show in an alert so admin
      // can manually copy. Shouldn't happen in practice; admin uses https.
      alert(text);
    }
  }

  function toggleMessaged(row: OutreachRow) {
    const next = !row.messagedAt;
    setBusyId(row.id);
    // Optimistic update so the checkbox feels instant.
    setRows((rs) =>
      rs.map((r) => (r.id === row.id ? { ...r, messagedAt: next ? new Date().toISOString() : null } : r)),
    );
    startTransition(async () => {
      const res = await setVenueMessaged(row.id, next);
      if ("error" in res) {
        alert(`Couldn't update: ${res.error}`);
        // Revert
        setRows((rs) =>
          rs.map((r) => (r.id === row.id ? { ...r, messagedAt: row.messagedAt } : r)),
        );
      } else {
        setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, messagedAt: res.at } : r)));
      }
      setBusyId(null);
    });
  }

  function openMessenger(row: OutreachRow, ev: React.MouseEvent) {
    const link = fbMessengerLink(row.facebook);
    if (link.kind === "page") {
      // Numeric profile.php or group — Messenger won't deep-link. Open the
      // page URL itself; admin clicks "Message" inside FB.
      ev.preventDefault();
      window.open(link.url, "_blank", "noopener,noreferrer");
    }
    // For the "messenger" kind the anchor's own href handles it.
  }

  return (
    <>
      <details className="card p-4 mb-4 group" open={editingTemplate}>
        <summary
          className="cursor-pointer list-none flex items-center justify-between gap-3"
          onClick={(e) => {
            e.preventDefault();
            setEditingTemplate((s) => !s);
          }}
        >
          <div>
            <div className="font-medium text-sm">📝 Message template</div>
            <div className="text-xs text-buzz-mute">
              Edit once, saved locally. Use <code className="text-buzz-accent">{"{venueName}"}</code> and <code className="text-buzz-accent">{"{claimLink}"}</code> as merge fields.
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

      <div className="flex flex-wrap gap-3 items-center mb-4">
        <div className="flex gap-1">
          {(["pending", "done", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={
                "px-3 py-1.5 rounded-full text-sm transition " +
                (filter === f
                  ? "bg-buzz-accent text-buzz-bg font-medium"
                  : "bg-buzz-card text-buzz-mute hover:text-buzz-fg")
              }
            >
              {f === "pending" && `Not yet messaged (${counts.pending})`}
              {f === "done" && `Messaged (${counts.done})`}
              {f === "all" && `All (${counts.all})`}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search by venue or city…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input flex-1 min-w-[200px]"
        />
      </div>

      {visible.length === 0 ? (
        <div className="card p-8 text-center text-buzz-mute">
          {filter === "pending"
            ? "Nice — every unclaimed venue with a Facebook URL has been messaged."
            : "No venues match this filter."}
        </div>
      ) : (
        <ul className="card divide-y divide-buzz-border/60">
          {visible.map((r) => {
            const link = fbMessengerLink(r.facebook);
            const isMessenger = link.kind === "messenger";
            return (
              <li key={r.id} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{r.name}</div>
                  <div className="text-xs text-buzz-mute truncate">
                    {r.cityName ?? "—"}
                    {" · "}
                    <a
                      href={r.facebook}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-buzz-accent truncate"
                    >
                      page ↗
                    </a>
                    {r.messagedAt && (
                      <> · <span className="text-emerald-400">messaged {timeAgo(r.messagedAt)}</span></>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => openMessenger(r, e)}
                    className="btn-secondary text-xs px-3 py-1.5"
                    title={isMessenger ? "Opens Messenger to this page" : "Opens the FB page — click Message once inside"}
                  >
                    {isMessenger ? "📩 Messenger" : "📄 Open page"}
                  </a>
                  <button
                    type="button"
                    onClick={() => copyForRow(r)}
                    className="btn-ghost text-xs px-3 py-1.5"
                    title="Copy the personalised message to clipboard"
                  >
                    {copiedId === r.id ? "✓ Copied" : "📋 Copy"}
                  </button>
                  <label
                    className={
                      "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs cursor-pointer select-none transition " +
                      (r.messagedAt
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-buzz-card text-buzz-mute hover:text-buzz-fg")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={!!r.messagedAt}
                      onChange={() => toggleMessaged(r)}
                      disabled={busyId === r.id}
                      className="accent-buzz-accent"
                    />
                    {r.messagedAt ? "Messaged" : "Mark sent"}
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-buzz-mute mt-4">
        Tip: open Messenger, click 📋 Copy here, paste into the chat, hit send,
        then tick the row. Personal-account messaging from your own FB stays
        fully within Facebook&apos;s ToS — there&apos;s no automation here, you&apos;re still
        sending each message yourself, just without the click-cost of finding
        each page.
      </p>
    </>
  );
}
