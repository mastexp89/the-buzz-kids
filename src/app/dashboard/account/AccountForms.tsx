"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ImageUploader from "@/components/ImageUploader";
import { updateProfile, updateEmail, updatePassword, deleteMyAccount } from "./actions";

type Result = { error?: string; ok?: boolean; info?: string };

function Status({ res }: { res: Result | null }) {
  if (!res) return null;
  if (res.error) return <div className="text-sm text-rose-400 mt-2">{res.error}</div>;
  if (res.info) return <div className="text-sm text-emerald-400 mt-2">{res.info}</div>;
  if (res.ok) return <div className="text-sm text-emerald-400 mt-2">Saved.</div>;
  return null;
}

export default function AccountForms({
  currentEmail,
  displayName,
  avatarUrl,
  role,
}: {
  currentEmail: string;
  displayName: string;
  avatarUrl: string;
  role: string;
}) {
  const router = useRouter();
  const [avatar, setAvatar] = useState(avatarUrl);
  const [pendProfile, startProfile] = useTransition();
  const [pendEmail, startEmail] = useTransition();
  const [pendPwd, startPwd] = useTransition();

  const [resProfile, setResProfile] = useState<Result | null>(null);
  const [resEmail, setResEmail] = useState<Result | null>(null);
  const [resPwd, setResPwd] = useState<Result | null>(null);

  return (
    <div className="flex flex-col gap-6">
      {/* Profile */}
      <form
        className="card p-6 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setResProfile(null);
          const fd = new FormData(e.currentTarget);
          startProfile(async () => {
            const r = await updateProfile(fd);
            setResProfile(r);
            if (r?.ok) router.refresh();
          });
        }}
      >
        <div>
          <p className="eyebrow text-[10px] mb-1">Profile</p>
          <h2 className="font-display text-xl uppercase">Your details</h2>
        </div>
        <div>
          <label className="label">Profile photo</label>
          <div className="flex items-start gap-3">
            <div
              className="w-16 h-16 rounded-full bg-buzz-surface border border-buzz-border bg-cover bg-center shrink-0 grid place-items-center text-2xl"
              style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}
            >
              {!avatar && <span aria-hidden>🙂</span>}
            </div>
            <div className="flex-1 min-w-0">
              <ImageUploader folder="avatars" value={avatar} onChange={setAvatar} maxDimension={400} />
            </div>
          </div>
          <input type="hidden" name="avatar_url" value={avatar} />
          <p className="help">Shown next to your reviews.</p>
        </div>
        <div>
          <label className="label">Display name</label>
          <input className="input" name="display_name" defaultValue={displayName} placeholder="Your name" />
          <p className="help">Shown on your account. Not visible to the public.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-buzz-mute">Role:</span>
          <span className={`chip ${role === "admin" ? "chip-accent" : ""}`}>{role}</span>
        </div>
        <Status res={resProfile} />
        <button type="submit" className="btn-primary self-start" disabled={pendProfile}>
          {pendProfile ? "Saving…" : "Save"}
        </button>
      </form>

      {/* Email */}
      <form
        className="card p-6 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setResEmail(null);
          const fd = new FormData(e.currentTarget);
          startEmail(async () => {
            const r = await updateEmail(fd);
            setResEmail(r);
          });
        }}
      >
        <div>
          <p className="eyebrow text-[10px] mb-1">Email</p>
          <h2 className="font-display text-xl uppercase">Change your email</h2>
          <p className="help mt-1">Current: <span className="text-buzz-text">{currentEmail}</span></p>
        </div>
        <div>
          <label className="label">New email</label>
          <input className="input" name="email" type="email" required placeholder="new@email.com" />
          <p className="help">We'll send a confirmation link to the new address. Click it to finish the change.</p>
        </div>
        <Status res={resEmail} />
        <button type="submit" className="btn-primary self-start" disabled={pendEmail}>
          {pendEmail ? "Sending…" : "Send confirmation"}
        </button>
      </form>

      {/* Password */}
      <form
        className="card p-6 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setResPwd(null);
          const fd = new FormData(e.currentTarget);
          startPwd(async () => {
            const r = await updatePassword(fd);
            setResPwd(r);
            if (r?.ok) (e.target as HTMLFormElement).reset();
          });
        }}
      >
        <div>
          <p className="eyebrow text-[10px] mb-1">Password</p>
          <h2 className="font-display text-xl uppercase">Change password</h2>
        </div>
        <div>
          <label className="label">New password</label>
          <input className="input" name="password" type="password" required minLength={8} />
          <p className="help">At least 8 characters.</p>
        </div>
        <div>
          <label className="label">Confirm new password</label>
          <input className="input" name="confirm" type="password" required minLength={8} />
        </div>
        <Status res={resPwd} />
        <button type="submit" className="btn-primary self-start" disabled={pendPwd}>
          {pendPwd ? "Updating…" : "Update password"}
        </button>
      </form>

      <DeleteAccountSection />
    </div>
  );
}

function DeleteAccountSection() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="card p-6 flex flex-col gap-4 border-rose-500/40">
      <div>
        <p className="eyebrow text-[10px] mb-1 text-rose-400">Danger zone</p>
        <h2 className="font-display text-xl uppercase">Delete my account</h2>
        <p className="help mt-2">
          Permanently deletes your profile, any venues you own, gigs you've created and uploaded photos.
          This can't be undone. <a href="/delete-account" className="text-buzz-accent hover:text-buzz-accent2">See what's kept and what's removed</a>.
        </p>
      </div>

      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-rose-500/50 text-rose-400 hover:bg-rose-500/10 transition text-sm font-bold"
        >
          🗑️ Delete account
        </button>
      )}

      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            const fd = new FormData(e.currentTarget);
            start(async () => {
              const r = await deleteMyAccount(fd);
              // Successful deletion redirects, so we only see this on failure
              if (r?.error) setError(r.error);
            });
          }}
          className="flex flex-col gap-3 rounded-lg border border-rose-500/40 bg-rose-500/5 p-4"
        >
          <div>
            <p className="text-sm text-rose-300 font-semibold">⚠️ This is permanent.</p>
            <p className="text-xs text-buzz-mute mt-1">
              Type <strong className="text-rose-400">DELETE</strong> below to confirm. Click Cancel if you've changed your mind.
            </p>
          </div>
          <input
            name="confirm_phrase"
            required
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type DELETE to confirm"
            className="input"
            autoComplete="off"
          />
          {error && <div className="text-sm text-rose-400">{error}</div>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending || confirmText.trim().toUpperCase() !== "DELETE"}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm font-bold"
            >
              {pending ? "Deleting…" : "Permanently delete my account"}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setConfirmText(""); setError(null); }}
              disabled={pending}
              className="btn-secondary text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
