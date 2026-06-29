"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Inline delete-account button for the web /delete-account page.
 * Renders a confirmation flow that requires the user to type their email,
 * then calls /api/account/delete.
 */
export default function DeleteAccountButton({
  userEmail,
}: {
  userEmail: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"idle" | "confirm" | "success">("idle");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function performDelete() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmEmail: userEmail }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBusy(false);
        setError(
          json?.error ??
            "Account deletion failed. Please email hello@thebuzzkids.co.uk and we'll do it manually.",
        );
        return;
      }
      // Sign out client-side too so the cookie is wiped.
      const supabase = createClient();
      await supabase.auth.signOut();
      setStep("success");
      setBusy(false);
      // Send the user home after a beat.
      setTimeout(() => router.push("/"), 2500);
    } catch (e: any) {
      setBusy(false);
      setError(e?.message ?? "Network error. Please try again.");
    }
  }

  if (step === "success") {
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-5">
        <p className="text-emerald-300 font-semibold mb-1">Account deleted</p>
        <p className="text-sm text-buzz-text/80">
          Your account and venues have been removed. Returning you to the home
          page…
        </p>
      </div>
    );
  }

  if (step === "idle") {
    return (
      <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-5">
        <p className="text-rose-300 font-semibold mb-1">Delete this account</p>
        <p className="text-sm text-buzz-text/80 mb-3">
          Signed in as <strong>{userEmail}</strong>. Deleting your account will
          permanently remove your profile, places, events and uploads. This
          cannot be undone.
        </p>
        <button
          type="button"
          onClick={() => setStep("confirm")}
          className="rounded-md bg-rose-500 hover:bg-rose-600 text-white px-4 py-2 text-sm font-semibold transition"
        >
          Delete my account
        </button>
      </div>
    );
  }

  // step === "confirm"
  const matches = typed.trim().toLowerCase() === userEmail.toLowerCase();

  return (
    <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-5 flex flex-col gap-3">
      <p className="text-rose-300 font-semibold">Final confirmation</p>
      <p className="text-sm text-buzz-text/90">
        Type your email <strong>{userEmail}</strong> to confirm. This will
        permanently delete your account and is irreversible.
      </p>
      <input
        type="email"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder="your-email@example.com"
        autoComplete="off"
        className="rounded-md bg-buzz-card border border-buzz-border px-3 py-2 text-sm"
        disabled={busy}
      />
      {error && (
        <p className="text-sm text-rose-300">{error}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setStep("idle");
            setTyped("");
            setError(null);
          }}
          className="rounded-md bg-buzz-card border border-buzz-border hover:border-buzz-mute text-buzz-text px-4 py-2 text-sm font-semibold transition"
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={performDelete}
          disabled={!matches || busy}
          className={`rounded-md px-4 py-2 text-sm font-semibold transition ${
            matches && !busy
              ? "bg-rose-500 hover:bg-rose-600 text-white"
              : "bg-rose-500/30 text-white/50 cursor-not-allowed"
          }`}
        >
          {busy ? "Deleting…" : "Permanently delete account"}
        </button>
      </div>
    </div>
  );
}
