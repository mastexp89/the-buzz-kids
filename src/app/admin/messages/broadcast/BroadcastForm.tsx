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
  // "inbox" = message users' dashboards (with optional email/push extras);
  // "app" = push notification ONLY, to every device with the app installed.
  const [mode, setMode] = useState<"inbox" | "app">("inbox");
  const [role, setRole] = useState<BroadcastTargetRole>("all");
  const [emailToo, setEmailToo] = useState(true);
  const [pushToo, setPushToo] = useState(false);
  const [pushTitle, setPushTitle] = useState("");
  // Anonymous = phones with the app installed but no user signed in.
  // Only meaningful when push is enabled.
  const [includeAnonymous, setIncludeAnonymous] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ sent: number; emailed: number; pushed: number; skipped: number } | null>(null);

  const appOnly = mode === "app";

  function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!body.trim()) return;
    if (appOnly) {
      if (!confirm(
        "Send this as a push notification to EVERY phone with the app installed (signed in or not)?\n\nNo inbox message or email — push only. This cannot be undone."
      )) return;
    } else {
      const recipientCount = counts[role] ?? 0;
      const channels: string[] = ["in-app inbox"];
      if (emailToo) channels.push("email");
      if (pushToo) {
        channels.push(includeAnonymous ? "push (incl. anonymous devices)" : "push");
      }
      if (!confirm(
        `Send this message to ${recipientCount} user${recipientCount === 1 ? "" : "s"} via ${channels.join(" + ")}?\n\nThis cannot be undone — they'll get it instantly.`
      )) return;
    }
    start(async () => {
      const r = await broadcastMessage({
        body,
        roleFilter: appOnly ? "all" : role,
        email: !appOnly && emailToo,
        push: appOnly || pushToo,
        pushTitle: pushTitle.trim() || undefined,
        includeAnonymous: !appOnly && pushToo && includeAnonymous,
        appOnly,
      });
      if ("error" in r) setError(r.error);
      else setResult({ sent: r.sent, emailed: r.emailed, pushed: r.pushed, skipped: r.skipped });
    });
  }

  if (result) {
    return (
      <div className="card p-8 text-center">
        <div className="text-5xl mb-3">{appOnly ? "🔔" : "📨"}</div>
        <h2 className="h-display text-3xl mb-2">Sent</h2>
        {appOnly ? (
          <p className="text-buzz-mute mb-1">
            🔔 {result.pushed} push notification{result.pushed === 1 ? "" : "s"} delivered to app devices.
          </p>
        ) : (
        <p className="text-buzz-mute mb-1">{result.sent} message{result.sent === 1 ? "" : "s"} delivered to inboxes.</p>
        )}
        {!appOnly && emailToo && (
          <p className="text-buzz-mute text-sm">
            {result.emailed} email{result.emailed === 1 ? "" : "s"} sent
            {result.skipped > 0 && `, ${result.skipped} skipped (no email or quota)`}
          </p>
        )}
        {!appOnly && pushToo && (
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
      {/* Delivery mode */}
      <div>
        <label className="label">Delivery</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode("inbox")}
            className={`rounded-lg border p-3 text-left transition ${!appOnly ? "border-buzz-accent bg-buzz-accent/10" : "border-buzz-border hover:border-buzz-accent/50"}`}
          >
            <div className="text-sm font-medium">📨 Inbox message</div>
            <div className="text-xs text-buzz-mute">Signed-in users' dashboards, optional email + push</div>
          </button>
          <button
            type="button"
            onClick={() => setMode("app")}
            className={`rounded-lg border p-3 text-left transition ${appOnly ? "border-buzz-accent bg-buzz-accent/10" : "border-buzz-border hover:border-buzz-accent/50"}`}
          >
            <div className="text-sm font-medium">🔔 App push only</div>
            <div className="text-xs text-buzz-mute">Every phone with the app (signed in or not) — no inbox, no email</div>
          </button>
        </div>
      </div>

      {!appOnly && (
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
      )}

      {(appOnly || pushToo) && (
        <div>
          <label className="label">Push title <span className="text-buzz-mute font-normal">(optional)</span></label>
          <input
            className="input"
            value={pushTitle}
            onChange={(e) => setPushTitle(e.target.value)}
            maxLength={80}
            placeholder={appOnly ? "The Buzz Kids" : "Message from The Buzz Kids"}
          />
          <p className="help">The bold headline on the notification. Keep it short.</p>
        </div>
      )}

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

      {!appOnly && (
        <>
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
        </>
      )}

      {error && <div className="text-sm text-rose-400">{error}</div>}

      <div className="flex gap-2 items-center">
        <button type="submit" disabled={pending || !body.trim()} className="btn-primary">
          {pending
            ? "Sending…"
            : appOnly
            ? "🔔 Send push to the app"
            : `📢 Send to ${counts[role] ?? 0}`}
        </button>
      </div>
    </form>
  );
}
