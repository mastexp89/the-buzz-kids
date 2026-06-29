"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createUserAccount } from "../../actions";

export default function NewUserForm() {
  const router = useRouter();
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "");
    const r = await createUserAccount({
      email,
      password: String(fd.get("password") ?? ""),
      displayName: String(fd.get("display_name") ?? ""),
      role: String(fd.get("role") ?? "parent") as any,
    });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setDone(email);
    e.currentTarget.reset();
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 flex flex-col gap-4">
      {done && (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-sm p-3">
          ✓ Account created for <strong>{done}</strong>. They can log in now with the password you set.{" "}
          <button type="button" onClick={() => router.refresh()} className="text-buzz-accent hover:underline">Refresh user list</button>
        </div>
      )}
      <div>
        <label className="label">Name</label>
        <input name="display_name" className="input" maxLength={80} placeholder="e.g. Sam Reid" />
      </div>
      <div>
        <label className="label">Email *</label>
        <input name="email" type="email" className="input" required maxLength={200} placeholder="them@email.com" />
      </div>
      <div>
        <label className="label">Password *</label>
        <div className="relative">
          <input name="password" type={showPw ? "text" : "password"} className="input pr-16" required minLength={8} placeholder="At least 8 characters" />
          <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-buzz-mute hover:text-buzz-accent">
            {showPw ? "Hide" : "Show"}
          </button>
        </div>
        <p className="help">Share this with them securely — they can change it later.</p>
      </div>
      <div>
        <label className="label">Role *</label>
        <select name="role" className="input" defaultValue="editor">
          <option value="editor">Editor — can add places, events &amp; deals (auto-approved)</option>
          <option value="admin">Super admin — full access to everything</option>
          <option value="parent">Parent — a normal user account</option>
        </select>
      </div>
      {error && <div className="text-sm text-rose-400">{error}</div>}
      <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
    </form>
  );
}
