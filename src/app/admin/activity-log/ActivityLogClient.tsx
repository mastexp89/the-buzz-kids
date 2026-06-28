"use client";

import Link from "next/link";
import { useState } from "react";

export type AuditRowProps = {
  id: string;
  kind: "venue" | "artist" | "organiser" | "event";
  action: "insert" | "update" | "delete";
  name: string;
  who: string | null;
  whoEmail: string | null;
  at: string;
  // changed_fields shape:
  //   update -> { fieldName: { old: jsonb, new: jsonb }, ... }
  //   insert -> the full row as { col: value, ... }
  //   delete -> the deleted row as { col: value, ... }
  changedFields: Record<string, unknown>;
  href: string | null;
};

// Fields we deliberately hide from the diff — they're either system noise
// (timestamps, ids) or known to be set by background work that auth.uid()
// can't filter out cleanly (cover photo URLs, scrape timestamps).
const HIDDEN_FIELDS = new Set([
  "id",
  "created_at",
  "updated_at",
  "last_facebook_scrape",
  "cover_photo_last_attempt",
  "auto_imported_from",
  "auto_import_confidence",
  "auto_import_source_url",
  "auto_import_image_url",
  "auto_import_post_text",
  "reviewed_at",
  "reviewed_by",
]);

const ACTION_LABEL: Record<AuditRowProps["action"], string> = {
  insert: "created",
  update: "updated",
  delete: "deleted",
};
const ACTION_COLOR: Record<AuditRowProps["action"], string> = {
  insert: "text-emerald-400",
  update: "text-buzz-mute",
  delete: "text-rose-400",
};

export default function ActivityLogClient({ rows }: { rows: AuditRowProps[] }) {
  return (
    <ul className="card divide-y divide-buzz-border/60">
      {rows.map((r) => (
        <Row key={r.id} row={r} />
      ))}
    </ul>
  );
}

function Row({ row: r }: { row: AuditRowProps }) {
  const [open, setOpen] = useState(false);
  const fields = visibleFields(r.changedFields, r.action);
  const hasDetail = fields.length > 0;

  return (
    <li className="p-4">
      <div className="flex items-start gap-3">
        <span className="text-base shrink-0" aria-hidden>
          {r.kind === "venue" && "🐝"}
          {r.kind === "artist" && "🎤"}
          {r.kind === "organiser" && "📋"}
          {r.kind === "event" && "🎟️"}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className={`text-[10px] uppercase tracking-wider ${ACTION_COLOR[r.action]}`}>
              {ACTION_LABEL[r.action]}
            </span>
            <span className="font-medium truncate">{r.name}</span>
          </div>
          <div className="text-xs text-buzz-mute truncate">
            {r.who || r.whoEmail || "—"}
            {r.who && r.whoEmail && (
              <span className="text-buzz-mute/60"> ({r.whoEmail})</span>
            )}
            {" · "}
            <RelativeTime iso={r.at} />
            {r.action === "update" && hasDetail && (
              <>
                {" · "}
                <span className="text-buzz-mute/80">
                  {fields.length} {fields.length === 1 ? "field" : "fields"} changed
                </span>
              </>
            )}
          </div>
        </div>
        {hasDetail && (
          <button
            type="button"
            onClick={() => setOpen((s) => !s)}
            className="text-xs text-buzz-mute hover:text-buzz-accent shrink-0"
            aria-expanded={open}
          >
            {open ? "Hide changes ▾" : "View changes ▸"}
          </button>
        )}
        {r.href && (
          <Link
            href={r.href}
            target="_blank"
            className="text-xs text-buzz-mute hover:text-buzz-accent shrink-0"
          >
            View ↗
          </Link>
        )}
      </div>

      {open && hasDetail && (
        <div className="mt-3 rounded-lg border border-buzz-border/60 bg-buzz-surface/40 p-3 text-xs space-y-2">
          {fields.map((f) => (
            <FieldDiff key={f.name} action={r.action} field={f} />
          ))}
        </div>
      )}
    </li>
  );
}

type Field = {
  name: string;
  oldValue: unknown;
  newValue: unknown;
};

function visibleFields(raw: Record<string, unknown>, action: AuditRowProps["action"]): Field[] {
  if (!raw || typeof raw !== "object") return [];
  const out: Field[] = [];
  for (const [name, value] of Object.entries(raw)) {
    if (HIDDEN_FIELDS.has(name)) continue;
    if (action === "update") {
      // { old, new }
      const v = value as { old?: unknown; new?: unknown } | null;
      if (!v || typeof v !== "object") continue;
      out.push({ name, oldValue: v.old ?? null, newValue: v.new ?? null });
    } else {
      // insert / delete: the value is the full column value, only one side.
      // We render with oldValue=null for inserts and newValue=null for deletes.
      if (value === null || value === "" || value === undefined) continue;
      out.push({
        name,
        oldValue: action === "delete" ? value : null,
        newValue: action === "insert" ? value : null,
      });
    }
  }
  // Stable display order: alphabetical, but bump common-interest fields up
  const priority = new Set([
    "name",
    "title",
    "approved",
    "status",
    "bio",
    "description",
    "image_url",
    "logo_url",
    "cover_photo_url",
    "address",
    "city_id",
    "start_time",
    "end_time",
  ]);
  return out.sort((a, b) => {
    const pa = priority.has(a.name) ? 0 : 1;
    const pb = priority.has(b.name) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });
}

function FieldDiff({
  action,
  field,
}: {
  action: AuditRowProps["action"];
  field: Field;
}) {
  if (action === "update") {
    return (
      <div>
        <div className="text-buzz-mute uppercase text-[10px] tracking-wider">
          {prettyName(field.name)}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 mt-0.5">
          <Side label="before" value={field.oldValue} flavour="old" />
          <Side label="after" value={field.newValue} flavour="new" />
        </div>
      </div>
    );
  }
  // insert / delete: show single value
  const flavour = action === "insert" ? "new" : "old";
  const value = action === "insert" ? field.newValue : field.oldValue;
  return (
    <div>
      <div className="text-buzz-mute uppercase text-[10px] tracking-wider">
        {prettyName(field.name)}
      </div>
      <div className="mt-0.5">
        <Side label={action === "insert" ? "added" : "was"} value={value} flavour={flavour} />
      </div>
    </div>
  );
}

function Side({
  label,
  value,
  flavour,
}: {
  label: string;
  value: unknown;
  flavour: "old" | "new";
}) {
  const display = renderValue(value);
  const colour =
    flavour === "old"
      ? "border-rose-500/30 bg-rose-500/5"
      : "border-emerald-500/30 bg-emerald-500/5";
  return (
    <div className={`rounded border ${colour} px-2 py-1`}>
      <div className="text-[9px] uppercase tracking-wider text-buzz-mute/70">{label}</div>
      <div className="break-words whitespace-pre-wrap text-buzz-fg/90">
        {display === "" ? <span className="text-buzz-mute italic">(empty)</span> : display}
      </div>
    </div>
  );
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    // Truncate long strings to keep the panel sane.
    if (v.length > 240) return v.slice(0, 240) + "…";
    return v;
  }
  // Arrays / objects: stringify compactly.
  try {
    const s = JSON.stringify(v);
    if (s.length > 240) return s.slice(0, 240) + "…";
    return s;
  } catch {
    return String(v);
  }
}

function prettyName(name: string): string {
  return name.replace(/_/g, " ");
}

function RelativeTime({ iso }: { iso: string }) {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - t);
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  let label: string;
  if (sec < 60) label = `${sec}s ago`;
  else if (min < 60) label = `${min}m ago`;
  else if (hr < 24) label = `${hr}h ago`;
  else if (day < 30) label = `${day}d ago`;
  else label = new Date(iso).toLocaleDateString("en-GB");
  return <span title={new Date(iso).toLocaleString("en-GB")}>{label}</span>;
}
