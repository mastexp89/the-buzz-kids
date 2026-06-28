"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function CheckEmailInner() {
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  const [busy, setBusy] = useState(false);
  // Anti-mash throttle so a user spamming the button can't get
  // Supabase-throttled (it rate-limits at ~60s per address) and gets
  // a clear cooldown indicator either way.
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const [tick, setTick] = useState(0);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "sent" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  // Re-render every second while the cooldown is active, so the button
  // shows a live "Resend in 42s" counter instead of going stale.
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [cooldownUntil]);

  const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
  const cooled = remaining === 0;
  // Eslint-quiet: tick is intentionally used to force re-renders.
  void tick;

  async function resend() {
    if (!email || busy || !cooled) return;
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: {
          emailRedirectTo:
            `${process.env.NEXT_PUBLIC_SITE_URL || window.location.origin}/auth/callback`,
        },
      });
      if (error) {
        setStatus({ kind: "error", message: error.message });
      } else {
        setStatus({ kind: "sent" });
        // Supabase enforces ~60s between resends per address. Match it
        // locally so the user sees the cooldown rather than a confusing
        // "For security purposes, you can only request this once every…"
        // error on a second click.
        setCooldownUntil(Date.now() + 60_000);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-16 text-center">
      <div className="text-5xl mb-4" aria-hidden>📬</div>
      <h1 className="font-display text-3xl font-bold mb-3">Check your email</h1>
      {email ? (
        <p className="text-buzz-mute mb-3">
          We've sent a confirmation link to{" "}
          <strong className="text-buzz-fg">{email}</strong>. Click it to verify
          your email and finish setting up your account.
        </p>
      ) : (
        <p className="text-buzz-mute mb-3">
          We've sent you a confirmation link. Click it to verify your email and
          finish setting up your account.
        </p>
      )}

      <div className="rounded-lg border border-buzz-border/60 bg-buzz-surface/40 p-4 text-left text-sm text-buzz-mute mb-6">
        <p className="font-medium text-buzz-fg mb-1">Don't see it after 2 minutes?</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>
            Check your <strong className="text-buzz-fg">spam / junk folder</strong>.
            Look for an email from{" "}
            <code className="text-buzz-accent">noreply@thebuzzguide.co.uk</code>.
          </li>
          <li>
            If it's there, mark it <strong className="text-buzz-fg">"not spam"</strong>{" "}
            so future emails land properly.
          </li>
          <li>Still nothing? Use the button below to resend.</li>
        </ol>
      </div>

      {email && (
        <>
          <button
            type="button"
            onClick={resend}
            disabled={busy || !cooled}
            className="btn-secondary"
          >
            {busy
              ? "Resending…"
              : !cooled
              ? `Resend in ${remaining}s`
              : status.kind === "sent"
              ? "✓ Sent — resend again"
              : "Resend confirmation email"}
          </button>
          {status.kind === "sent" && (
            <p className="text-emerald-400 text-sm mt-3">
              ✓ Sent. Check your inbox (and spam folder) in a minute or two.
            </p>
          )}
          {status.kind === "error" && (
            <p className="text-rose-400 text-sm mt-3">{status.message}</p>
          )}
        </>
      )}
    </div>
  );
}

export default function CheckEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-md mx-auto px-4 py-16 text-center text-buzz-mute">
          Loading…
        </div>
      }
    >
      <CheckEmailInner />
    </Suspense>
  );
}
