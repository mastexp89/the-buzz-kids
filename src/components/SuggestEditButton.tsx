"use client";

// "Suggest an edit" for a place or a What's On item. Sits quietly as a small
// link; expands into a lightweight form (reason + free text + optional
// contact + an "I run this" tick). No account needed — everything lands in
// the admin edit_suggestions queue. This is how businesses reach us now that
// self-service owner accounts are switched off.

import { useState } from "react";
import { submitEditSuggestion } from "@/lib/edit-suggestion-actions";

const REASONS: Record<"venue" | "event", string[]> = {
  venue: ["Closed down", "Moved location", "Wrong details", "Prices / times changed", "Something else"],
  event: ["Cancelled", "Date / time changed", "Wrong details", "Not on anymore", "Something else"],
};

export default function SuggestEditButton({
  targetType,
  targetId,
  targetName,
  citySlug,
}: {
  targetType: "venue" | "event";
  targetId: string;
  targetName: string;
  citySlug?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const thing = targetType === "venue" ? "place" : "activity";

  if (state === "done") {
    return (
      <span className="text-xs text-buzz-mute">
        ✓ Thanks — we&apos;ll check it{isOwner ? " and be in touch" : ""}.
      </span>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-buzz-mute hover:text-buzz-accent underline underline-offset-2 transition"
      >
        ✏️ Suggest an edit — something wrong or out of date?
      </button>
    );
  }

  async function submit() {
    if (!reason && !details.trim()) {
      setErrorMsg("Pick a reason or tell us what should change.");
      setState("error");
      return;
    }
    setState("busy");
    setErrorMsg(null);
    const res = await submitEditSuggestion({
      targetType,
      targetId,
      targetName,
      citySlug,
      reason: reason ?? undefined,
      details,
      contactName: name,
      contactEmail: email,
      isOwner,
      newsletter: newsletter && !!email.trim(),
    });
    if (res.error) {
      setErrorMsg(res.error);
      setState("error");
      return;
    }
    setState("done");
  }

  return (
    <div className="card p-4 max-w-md text-sm">
      <div className="flex items-center justify-between mb-2">
        <p className="font-medium">Suggest an edit</p>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-buzz-mute hover:text-buzz-text">
          ✕
        </button>
      </div>

      <p className="text-xs text-buzz-mute mb-2">What&apos;s wrong with this {thing}?</p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {REASONS[targetType].map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setReason(reason === r ? null : r)}
            className={`rounded-full border px-2.5 py-1 text-xs transition ${
              reason === r
                ? "border-buzz-accent bg-buzz-accent/10 text-buzz-accent"
                : "border-buzz-border hover:border-buzz-accent hover:text-buzz-accent"
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      <textarea
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        placeholder="What should it say? e.g. new opening hours, correct price, moved to…"
        maxLength={2000}
        className="input min-h-[80px] text-sm mb-3"
      />

      <label className="flex items-center gap-2 mb-3 cursor-pointer select-none">
        <input type="checkbox" checked={isOwner} onChange={(e) => setIsOwner(e.target.checked)} />
        <span className="text-xs">I run this {thing}</span>
      </label>

      <div className="grid sm:grid-cols-2 gap-2 mb-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name (optional)"
          maxLength={120}
          className="input text-sm"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="Email (optional)"
          maxLength={200}
          className="input text-sm"
        />
      </div>
      <p className="help !mt-0 mb-2">Leave an email only if you&apos;d like us to reply.</p>

      {email.trim() && (
        <label className="flex items-center gap-2 mb-3 cursor-pointer select-none">
          <input type="checkbox" checked={newsletter} onChange={(e) => setNewsletter(e.target.checked)} />
          <span className="text-xs">📩 Keep me posted — occasional Buzz Kids news &amp; holiday ideas</span>
        </label>
      )}

      {state === "error" && errorMsg && <p className="text-xs text-rose-500 mb-2">{errorMsg}</p>}

      <button type="button" onClick={submit} disabled={state === "busy"} className="btn-primary text-sm disabled:opacity-60">
        {state === "busy" ? "Sending…" : "Send it in"}
      </button>
    </div>
  );
}
