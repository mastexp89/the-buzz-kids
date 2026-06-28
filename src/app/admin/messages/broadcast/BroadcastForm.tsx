"use client";

import { useState, useTransition } from "react";
import { broadcastMessage, type BroadcastTargetRole } from "@/lib/messages-actions";

const ROLE_OPTIONS: { value: BroadcastTargetRole; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "user", label: "Fans only" },
  { value: "venue_owner", label: "Venues only" },
  { value: "artist", label: "Artists / DJs only" },
  { value: "event_organiser", label: "Event organisers only" },
];

export default function BroadcastForm({
  counts,
}: {
  counts: Record<string, number>;
}) {
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const [role, setRole] = useState<BroadcastTargetRole>("all");
  const [emailToo, setEmailToo] = useState(true);
  const [pushToo, setPushToo] = useState(false);
  // Anonymous = phones with the app installed but no user signed in.
  // Only meaningful when push is enabled.
  const [includeAnonymous, setIncludeAnonymous] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ sent: number; emailed: number; pushed: number; skipped: number } | null>(null);

  function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!body.trim()) return;
    const recipientCount = counts[role] ?? 0;
    const channels: string[] = ["in-app inbox"];
    if (emailToo) channels.push("email");
    if (pushToo) {
      channels.push(includeAnonymous ? "push (incl. anonymous devices)" : "push");
    }
    if (!confirm(
      `Send this message to ${recipientCount} user${recipientCount === 1 ? "" : "s"} via ${channels.join(" + ")}?\n\nThis cannot be undone — they'll get it instantly.`
    )) return;
    start(async () => {
      const r = await broadcastMessage({
        body,
        roleFilter: role,
        email: emailToo,
        push: pushToo,
        includeAnonymous: pushToo && includeAnonymous,
      });
      if ("error" in r) setError(r.error);
      else setResult({ sent: r.sent, emailed: r.emailed, pushed: r.pushed, skipped: r.skipped });
    });
  }

  if (result) {
    return (
      <div className="card p-8 text-center">
        <div className="text-5xl mb-3">📨</div>
        <h2 className="h-display text-3xl mb-2">Sent</h2>
        <p className="text-buzz-mute mb-1">{result.sent} message{result.sent === 1 ? "" : "s"} delivered to inboxes.</p>
        {emailToo && (
          <p className="text-buzz-mute text-sm">
            {result.emailed} email{result.emailed === 1 ? "" : "s"} sent
            {result.skipped > 0 && `, ${result.skipped} skipped (no email or quota)`}
          </p>
        )}
        {pushToo && (
          <p className="text-buzz-mute text-sm">
            🔔 {result.pushed} push notification{result.pushed === 1 ? "" : "s"} delivered to mobile devices
          </p>
        )}
        <button
          type="button"
          onClick={() => { setResult(null); setBody(""); }}
          className="btn-secondary mt-4"
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={send} className="card p-5 flex flex-col gap-4">
      <div>
        <label className="label">Send to</label>
        <select
          className="input"
          value={role}
          onChange={(e) => setRole(e.target.value as BroadcastTargetRole)}
        >
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} ({counts[o.value] ?? 0})
            </option>
          ))}
        </select>
        <p className="help">Excludes admin accounts.</p>
      </div>

      <div>
        <label className="label">Message</label>
        <textarea
          className="input min-h-[160px]"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={5000}
          placeholder="Hi everyone — heads up that…"
        />
        <p className="help">Plain text. {body.length} / 5000 chars.</p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={emailToo}
          onChange={(e) => setEmailToo(e.target.checked)}
        />
        Also email recipients (capped at 100/day on free tier)
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={pushToo}
          onChange={(e) => setPushToo(e.target.checked)}
        />
        🔔 Also push to mobile devices (silent for users without the app)
      </label>

      {pushToo && (
        <label className="flex items-start gap-2 text-sm ml-6 border-l-2 border-buzz-border pl-3">
          <input
            type="checkbox"
            checked={includeAnonymous}
            onChange={(e) => setIncludeAnonymous(e.target.checked)}
            className="mt-1"
          />
          <span>
            📱 Also include <strong>anonymous devices</strong> — phones with the app installed but no user signed in.
            They&apos;ll receive the push notification only (no inbox message, since they have no account).
          </span>
        </label>
      )}

      {error && <div className="text-sm text-rose-400">{error}</div>}

      <div className="flex gap-2 items-center">
        <button type="submit" disabled={pending || !body.trim()} className="btn-primary">
          {pending ? "Sending…" : `📢 Send to ${counts[role] ?? 0}`}
        </button>
      </div>
    </form>
  );
}
