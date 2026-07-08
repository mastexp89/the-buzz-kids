"use client";

import { useState } from "react";
import { sendTestBroadcast, sendBroadcastNow, type Audience } from "./actions";

type Counts = { waitlist: number; parents: number; unsubscribed: number };

const LAUNCH = {
  subject: "The Buzz Kids is now live! 🐝",
  heading: "We're live!",
  body:
    "Hi there — thanks for signing up for early access. The Buzz Kids is officially open!\n\n" +
    "It's your free guide to kid-friendly things to do across Scotland — soft play, farm parks, messy play, holiday clubs, kids' theatre and loads more. Filter by age, price, and whether it's indoor or outdoor.\n\n" +
    "Create your free parent account to save places to your bucket list, leave reviews for other families, and get alerts when new sessions land for the school holidays.",
  ctaLabel: "Create your free account",
  ctaUrl: "/signup?as=fan",
};

export default function BroadcastClient({ counts }: { counts: Counts }) {
  const [audience, setAudience] = useState<Audience>("waitlist");
  const [subject, setSubject] = useState("");
  const [heading, setHeading] = useState("");
  const [body, setBody] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [busy, setBusy] = useState<null | "test" | "send">(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const audienceCount = audience === "waitlist" ? counts.waitlist : audience === "parents" ? counts.parents : counts.waitlist + counts.parents;

  function loadLaunch() {
    setSubject(LAUNCH.subject); setHeading(LAUNCH.heading); setBody(LAUNCH.body);
    setCtaLabel(LAUNCH.ctaLabel); setCtaUrl(LAUNCH.ctaUrl); setMsg(null);
  }

  const compose = () => ({ subject, heading, body, ctaLabel, ctaUrl });

  async function onTest() {
    setBusy("test"); setMsg(null);
    const r = await sendTestBroadcast(compose());
    setBusy(null);
    setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: "Test sent to your admin email — check it looks right before sending for real." });
  }

  async function onSend() {
    if (!confirm(`Send this email to ~${audienceCount} ${audience === "parents" ? "parent accounts" : audience === "waitlist" ? "waitlist emails" : "recipients"}?\n\nThis goes to real inboxes and can't be undone.`)) return;
    setBusy("send"); setMsg(null);
    const r = await sendBroadcastNow({ ...compose(), audience });
    setBusy(null);
    if (r.error) { setMsg({ ok: false, text: r.error }); return; }
    setMsg({ ok: true, text: `Sent to ${r.sent}. ${r.skipped ? `${r.skipped} skipped (unsubscribed). ` : ""}${r.failed ? `${r.failed} failed.` : ""}`.trim() });
  }

  const AUD: { key: Audience; label: string; n: number }[] = [
    { key: "waitlist", label: "Mailing list", n: counts.waitlist },
    { key: "parents", label: "Parent accounts", n: counts.parents },
    { key: "both", label: "Everyone", n: counts.waitlist + counts.parents },
  ];

  return (
    <div className="card p-6 flex flex-col gap-4">
      <div>
        <label className="label">Send to</label>
        <div className="grid grid-cols-3 gap-2">
          {AUD.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => setAudience(a.key)}
              className={`rounded-lg border p-3 text-left transition ${audience === a.key ? "border-buzz-accent bg-buzz-accent/10" : "border-buzz-border hover:border-buzz-accent/50"}`}
            >
              <div className="text-sm font-medium">{a.label}</div>
              <div className="text-xs text-buzz-mute">{a.n} {a.n === 1 ? "person" : "people"}</div>
            </button>
          ))}
        </div>
        <p className="help">{counts.unsubscribed} unsubscribed — always skipped. "Everyone" de-dupes overlaps.</p>
      </div>

      <div className="flex items-center justify-between">
        <label className="label !mb-0">Message</label>
        <button type="button" onClick={loadLaunch} className="text-xs text-buzz-accent hover:underline">✨ Use launch template</button>
      </div>

      <div>
        <label className="label">Subject *</label>
        <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} placeholder="The Buzz Kids is now live! 🐝" />
      </div>
      <div>
        <label className="label">Headline <span className="text-buzz-mute font-normal">(big text at the top, optional)</span></label>
        <input className="input" value={heading} onChange={(e) => setHeading(e.target.value)} maxLength={100} placeholder="We're live!" />
      </div>
      <div>
        <label className="label">Body *</label>
        <textarea className="input min-h-[180px]" value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} placeholder="Write your message. Leave a blank line between paragraphs." />
        <p className="help">A blank line starts a new paragraph.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Button text <span className="text-buzz-mute font-normal">(optional)</span></label>
          <input className="input" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} maxLength={40} placeholder="Create your free account" />
        </div>
        <div>
          <label className="label">Button link</label>
          <input className="input" value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="/signup?as=fan" />
        </div>
      </div>

      {msg && <div className={`text-sm rounded-lg px-3 py-2 ${msg.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-500"}`}>{msg.text}</div>}

      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={onTest} disabled={!!busy} className="btn-secondary">
          {busy === "test" ? "Sending…" : "Send test to me"}
        </button>
        <button type="button" onClick={onSend} disabled={!!busy} className="btn-primary">
          {busy === "send" ? "Sending…" : `Send to ~${audienceCount} →`}
        </button>
      </div>
    </div>
  );
}
