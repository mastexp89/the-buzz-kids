"use client";

import { useState } from "react";

// Inline newsletter capture for the homepage — posts to the existing
// /api/notify-signup endpoint (upserts notify_signups + pings the team).
export default function NewsletterInline() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setMsg("");
    try {
      const res = await fetch("/api/notify-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setState("done");
      } else {
        setState("error");
        setMsg(data?.error ?? "Something went wrong. Please try again.");
      }
    } catch {
      setState("error");
      setMsg("Something went wrong. Please try again.");
    }
  }

  if (state === "done") {
    return (
      <p className="mt-4 font-bold text-buzz-text">
        🎉 You&apos;re in! We&apos;ll be in touch with great family days out.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 max-w-md">
      <div className="flex items-center gap-2 bg-white rounded-full p-1.5 pl-5">
        <span className="text-buzz-mute" aria-hidden>✉️</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Your email address"
          aria-label="Email address"
          className="flex-1 min-w-0 bg-transparent outline-none font-semibold py-2"
        />
        <button
          type="submit"
          disabled={state === "sending"}
          className="rounded-full bg-buzz-pink text-white font-extrabold px-5 py-3 shrink-0 hover:brightness-105 transition disabled:opacity-60"
        >
          {state === "sending" ? "…" : "Sign me up →"}
        </button>
      </div>
      {state === "error" && <p className="mt-2 text-sm text-rose-500 font-semibold">{msg}</p>}
    </form>
  );
}
