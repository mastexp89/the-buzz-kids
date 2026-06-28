"use client";

import { useState, useTransition } from "react";
import {
  updateNotificationPrefs,
  type NotificationPrefs,
} from "./actions";

type Toggle = {
  key: keyof NotificationPrefs;
  label: string;
  desc: string;
};

const TOGGLES: Toggle[] = [
  {
    key: "new_gig_at_favourite_venue",
    label: "New gigs at venues you follow",
    desc: "When a venue you've favourited adds a new gig, you'll get a digest the same hour.",
  },
  {
    key: "new_gig_with_favourite_artist",
    label: "New gigs featuring artists you follow",
    desc: "Whenever an artist you've favourited is tagged on a gig at any venue.",
  },
  {
    key: "new_gig_from_favourite_organiser",
    label: "New gigs from organisers you follow",
    desc: "When an organiser you've favourited announces a new show.",
  },
  {
    key: "morning_of_reminder",
    label: "Morning-of reminder",
    desc: "A daily digest at 8am with every favourite gig happening that day.",
  },
  {
    key: "fifteen_minute_reminder",
    label: "15 minutes before",
    desc: "A heads-up 15 minutes before a favourite gig starts, with a Maps link.",
  },
];

export default function NotificationPrefsClient({
  initial,
  email,
}: {
  initial: NotificationPrefs;
  email: string;
}) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(initial);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggle(key: keyof NotificationPrefs, next: boolean) {
    setError(null);
    setSaved(false);
    const prev = prefs[key];
    // optimistic
    setPrefs((p) => ({ ...p, [key]: next }));
    startTransition(async () => {
      const res = await updateNotificationPrefs({ [key]: next });
      if ("error" in res) {
        setError(res.error);
        setPrefs((p) => ({ ...p, [key]: prev })); // revert
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  }

  function setAll(value: boolean) {
    setError(null);
    setSaved(false);
    const next: NotificationPrefs = {
      new_gig_at_favourite_venue: value,
      new_gig_with_favourite_artist: value,
      new_gig_from_favourite_organiser: value,
      morning_of_reminder: value,
      fifteen_minute_reminder: value,
    };
    const prev = prefs;
    setPrefs(next);
    startTransition(async () => {
      const res = await updateNotificationPrefs(next);
      if ("error" in res) {
        setError(res.error);
        setPrefs(prev);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  }

  return (
    <>
      <div className="card p-4 flex flex-col gap-3">
        <div className="text-xs text-buzz-mute">
          Emails go to <strong className="text-buzz-fg">{email}</strong>.
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAll(true)}
            disabled={busy}
            className="btn-secondary text-xs"
          >
            Turn all on
          </button>
          <button
            type="button"
            onClick={() => setAll(false)}
            disabled={busy}
            className="btn-ghost text-xs"
          >
            Mute everything
          </button>
          {saved && <span className="text-xs text-emerald-400 self-center">✓ Saved</span>}
          {error && <span className="text-xs text-rose-400 self-center">{error}</span>}
        </div>
      </div>

      <ul className="card divide-y divide-buzz-border/60">
        {TOGGLES.map((t) => (
          <li key={t.key} className="p-4 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-medium">{t.label}</div>
              <div className="text-xs text-buzz-mute mt-0.5">{t.desc}</div>
            </div>
            <label className="inline-flex items-center cursor-pointer shrink-0">
              <span className="sr-only">{t.label}</span>
              <input
                type="checkbox"
                className="sr-only"
                checked={prefs[t.key]}
                onChange={(e) => toggle(t.key, e.target.checked)}
                disabled={busy}
              />
              <span
                className={
                  "relative inline-block w-11 h-6 rounded-full transition " +
                  (prefs[t.key] ? "bg-buzz-accent" : "bg-buzz-surface")
                }
              >
                <span
                  className={
                    "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform " +
                    (prefs[t.key] ? "translate-x-5" : "")
                  }
                />
              </span>
            </label>
          </li>
        ))}
      </ul>
    </>
  );
}
