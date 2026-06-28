"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateUserProfile,
  reassignVenue,
  deleteUserProfile,
  sendPasswordResetEmail,
  forceSetUserPassword,
  createArtistForUser,
  generateImpersonationLink,
  searchUnclaimedArtistsForUser,
  assignArtistToUser,
  searchVenuesForAssign,
} from "./actions";

type Profile = { id: string; email: string | null; display_name: string | null; role: string };
type VenueLite = {
  id: string;
  name: string;
  slug: string;
  approved: boolean;
  created_at: string;
  city: { name: string; slug: string } | null;
};
type ArtistLite = {
  id: string;
  name: string;
  slug: string;
  approved: boolean;
  created_at: string;
};

export default function UserDetailClient({
  target,
  venues,
  artists,
  otherOwners,
  isCurrentUser,
}: {
  target: Profile;
  venues: VenueLite[];
  artists: ArtistLite[];
  otherOwners: { id: string; email: string | null; display_name: string | null }[];
  isCurrentUser: boolean;
}) {
  const router = useRouter();
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [reassigning, startReassign] = useTransition();
  const [resetting, startReset] = useTransition();
  const [setting, startSet] = useTransition();
  const [creatingArtist, startCreateArtist] = useTransition();
  const [newPassword, setNewPassword] = useState("");
  const [showSetPwd, setShowSetPwd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Assign-to-existing-artist panel state
  const [showAssign, setShowAssign] = useState(false);
  const [assignQuery, setAssignQuery] = useState(target.display_name ?? "");
  const [assignResults, setAssignResults] = useState<Array<{ id: string; name: string; slug: string; image_url: string | null; recent_event_count: number }> | null>(null);
  const [assignSearching, setAssignSearching] = useState(false);
  const [assignBusyId, setAssignBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!showAssign) return;
    let cancelled = false;
    if (assignQuery.trim().length < 2) {
      setAssignResults(null);
      return;
    }
    setAssignSearching(true);
    const t = setTimeout(async () => {
      const r = await searchUnclaimedArtistsForUser(assignQuery);
      if (cancelled) return;
      if ("error" in r) {
        setError(r.error);
        setAssignResults([]);
      } else {
        setAssignResults(r.results);
      }
      setAssignSearching(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [assignQuery, showAssign]);

  function onAssign(artistId: string) {
    setError(null);
    setInfo(null);
    setAssignBusyId(artistId);
    startCreateArtist(async () => {
      const res = await assignArtistToUser(target.id, artistId);
      setAssignBusyId(null);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setShowAssign(false);
      setInfo(`Assigned to "${res.name}".`);
      router.refresh();
    });
  }

  // Assign-existing-venue panel state (mirrors the artist version above).
  const [showAssignVenue, setShowAssignVenue] = useState(false);
  const [venueQuery, setVenueQuery] = useState(target.display_name ?? "");
  const [venueResults, setVenueResults] = useState<Array<{
    id: string;
    name: string;
    slug: string;
    approved: boolean;
    cityName: string | null;
    citySlug: string | null;
    currentOwnerName: string | null;
    currentOwnerEmail: string | null;
    currentOwnerId: string | null;
  }> | null>(null);
  const [venueSearching, setVenueSearching] = useState(false);
  const [venueBusyId, setVenueBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!showAssignVenue) return;
    let cancelled = false;
    if (venueQuery.trim().length < 2) {
      setVenueResults(null);
      return;
    }
    setVenueSearching(true);
    const t = setTimeout(async () => {
      const r = await searchVenuesForAssign(venueQuery, target.id);
      if (cancelled) return;
      if ("error" in r) {
        setError(r.error);
        setVenueResults([]);
      } else {
        setVenueResults(r.results);
      }
      setVenueSearching(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [venueQuery, showAssignVenue, target.id]);

  function onAssignVenue(venueId: string) {
    if (!confirm("Transfer this venue to this user? They'll be able to edit it from their dashboard immediately.")) return;
    setError(null);
    setInfo(null);
    setVenueBusyId(venueId);
    startReassign(async () => {
      const res = await reassignVenue(venueId, target.id);
      setVenueBusyId(null);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setShowAssignVenue(false);
      setInfo("Venue assigned.");
      router.refresh();
    });
  }

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const fd = new FormData(e.currentTarget);
    startSave(async () => {
      const res = await updateUserProfile(target.id, fd);
      if (res?.error) setError(res.error);
      else { setInfo("Saved."); router.refresh(); }
    });
  }

  function onReassign(venueId: string, newOwnerId: string) {
    if (!newOwnerId) return;
    if (!confirm("Transfer this venue to the selected owner? They'll be able to edit it from their dashboard.")) return;
    setError(null); setInfo(null);
    startReassign(async () => {
      const res = await reassignVenue(venueId, newOwnerId);
      if (res?.error) setError(res.error);
      else { setInfo("Venue reassigned."); router.refresh(); }
    });
  }

  function onDelete() {
    if (!confirm(
      `Permanently delete ${target.email}?\n\n` +
      `This removes their auth account, profile and login. Cannot be undone. ` +
      `If they still own venues this will refuse — reassign or delete those first.`
    )) return;
    startDelete(async () => {
      const res = await deleteUserProfile(target.id);
      if (res?.error) setError(res.error);
    });
  }

  function onSendReset() {
    setError(null); setInfo(null);
    if (!confirm(`Email a password reset link to ${target.email}? They'll click it to choose a new password themselves.`)) return;
    startReset(async () => {
      const res = await sendPasswordResetEmail(target.id);
      if (res?.error) setError(res.error);
      else setInfo(`Reset link sent to ${target.email}.`);
    });
  }

  function onSetPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setInfo(null);
    const pwd = newPassword.trim();
    if (pwd.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (!confirm(`Force-set the password for ${target.email}? You must securely tell them the new password — they will not be notified by email.`)) return;
    startSet(async () => {
      const res = await forceSetUserPassword(target.id, pwd);
      if (res?.error) setError(res.error);
      else {
        setInfo(`Password updated. Send "${pwd}" to ${target.email} via a secure channel.`);
        setNewPassword("");
        setShowSetPwd(false);
      }
    });
  }

  function onCreateArtist() {
    setError(null); setInfo(null);
    if (!confirm(`Create an artist page for ${target.display_name || target.email}? They'll be able to edit their bio, photo and socials immediately.`)) return;
    startCreateArtist(async () => {
      const res = await createArtistForUser(target.id);
      if (res?.error) setError(res.error);
      else { setInfo("Artist page created."); router.refresh(); }
    });
  }

  const [impersonating, startImpersonate] = useTransition();
  const [impersonateLink, setImpersonateLink] = useState<string | null>(null);
  function onGenerateImpersonationLink() {
    setError(null); setInfo(null); setImpersonateLink(null);
    startImpersonate(async () => {
      const res = await generateImpersonationLink(target.id);
      if (res && "error" in res && res.error) {
        setError(res.error);
      } else if (res && "link" in res && res.link) {
        setImpersonateLink(res.link);
      } else {
        setError("Couldn't generate link.");
      }
    });
  }

  function generatePassword() {
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let out = "";
    const arr = new Uint32Array(14);
    crypto.getRandomValues(arr);
    for (let i = 0; i < 14; i++) out += chars[arr[i] % chars.length];
    setNewPassword(out);
  }

  const isArtistRole = target.role === "artist";

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={onSave} className="card p-6 grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <h2 className="font-display text-xl uppercase">Profile</h2>
          <p className="help mt-0.5">Email is managed by Supabase auth and can't be edited here — the user must change it from their account settings.</p>
        </div>

        <div>
          <label className="label">Email (read-only)</label>
          <input className="input opacity-60" value={target.email ?? ""} disabled />
        </div>

        <div>
          <label className="label">Display name</label>
          <input className="input" name="display_name" defaultValue={target.display_name ?? ""} placeholder="How they appear publicly" />
        </div>

        <div className="sm:col-span-2">
          <label className="label">Role</label>
          <select name="role" defaultValue={target.role} className="input" disabled={isCurrentUser}>
            <option value="user">♡ Fan</option>
            <option value="venue_owner">Venue owner</option>
            <option value="artist">Artist / DJ</option>
            <option value="event_organiser">Event organiser</option>
            <option value="admin">Admin</option>
          </select>
          {isCurrentUser ? (
            <p className="help">You can't change your own role.</p>
          ) : (
            <p className="help">
              Saving syncs the user's auth metadata (account_type) too, so admin notifications stay accurate.
              Switching a venue/artist/organiser <strong>down</strong> to a fan doesn't delete what they own — reassign or delete those separately first.
            </p>
          )}
        </div>

        {error && <div className="sm:col-span-2 text-sm text-rose-400">{error}</div>}
        {info && <div className="sm:col-span-2 text-sm text-emerald-400">{info}</div>}

        <div className="sm:col-span-2 flex gap-2 flex-wrap">
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Saving…" : "Save profile"}
          </button>
          {!isCurrentUser && (
            <Link href={`/admin/messages/${target.id}`} className="btn-secondary">
              📬 Send a message
            </Link>
          )}
          {!isCurrentUser && (
            <button type="button" onClick={onDelete} disabled={deleting} className="btn-danger">
              {deleting ? "Deleting…" : "Delete profile"}
            </button>
          )}
        </div>
      </form>

      {!isCurrentUser && (
        <section className="card p-6 flex flex-col gap-4">
          <div>
            <h2 className="font-display text-xl uppercase">Password</h2>
            <p className="help mt-0.5">
              Reset the user's password by emailing them a link, or force-set one if they've lost access to their email too.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onSendReset} disabled={resetting || setting} className="btn-primary">
              {resetting ? "Sending…" : "📧 Email password reset link"}
            </button>
            <button type="button" onClick={() => setShowSetPwd((v) => !v)} className="btn-secondary">
              {showSetPwd ? "Cancel" : "🔑 Set password directly"}
            </button>
          </div>

          <div className="pt-3 border-t border-buzz-border/60">
            <p className="help mb-2">
              👤 <strong>Sign in as them</strong> — generate a one-time magic link.
              Open it in <em>incognito</em> so your admin session stays intact.
              The link expires after one click.
            </p>
            <button
              type="button"
              onClick={onGenerateImpersonationLink}
              disabled={impersonating}
              className="btn-secondary"
            >
              {impersonating ? "Generating…" : "👤 Get sign-in link"}
            </button>
            {impersonateLink && (
              <div className="mt-3 p-3 rounded-lg bg-buzz-surface border border-buzz-border">
                <p className="text-xs text-buzz-mute mb-2">
                  Copy this link, then paste it into an incognito window:
                </p>
                <div className="flex gap-2 items-stretch">
                  <input
                    readOnly
                    value={impersonateLink}
                    onClick={(e) => e.currentTarget.select()}
                    className="input flex-1 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(impersonateLink);
                      setInfo("Link copied to clipboard.");
                    }}
                    className="btn-secondary"
                  >
                    Copy
                  </button>
                </div>
                <p className="text-xs text-rose-400 mt-2">
                  ⚠️ One-time use. Don't share. Treat like a password.
                </p>
              </div>
            )}
          </div>

          {showSetPwd && (
            <form onSubmit={onSetPassword} className="flex flex-col gap-3 pt-3 border-t border-buzz-border/60">
              <p className="text-xs text-buzz-mute">
                ⚠️ Use only as a last resort. The user is <strong>not</strong> notified — you'll need to securely tell them the new password yourself.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  className="input flex-1 font-mono"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New password (min 8 chars)"
                  minLength={8}
                  required
                  autoComplete="off"
                />
                <button type="button" onClick={generatePassword} className="btn-secondary">
                  Generate
                </button>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={setting} className="btn-primary">
                  {setting ? "Updating…" : "Set password"}
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {(isArtistRole || artists.length > 0) && (
        <section>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="font-display text-xl uppercase">
              Their artist page{artists.length === 1 ? "" : "s"}{" "}
              <span className="text-buzz-mute text-sm font-normal">({artists.length})</span>
            </h2>
            {artists.length === 0 && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAssign((v) => !v);
                    setError(null);
                  }}
                  disabled={creatingArtist}
                  className="btn-secondary"
                >
                  {showAssign ? "Cancel" : "🔗 Assign to existing artist"}
                </button>
                <button
                  type="button"
                  onClick={onCreateArtist}
                  disabled={creatingArtist}
                  className="btn-primary"
                >
                  {creatingArtist ? "Creating…" : "+ Create artist page"}
                </button>
              </div>
            )}
          </div>
          {showAssign && artists.length === 0 && (
            <div className="card p-5 mb-3 border-buzz-accent/40">
              <p className="eyebrow text-buzz-accent text-[10px]">Assign existing</p>
              <h3 className="font-display text-lg mb-2">
                Pick an unclaimed artist page to link to this user
              </h3>
              <p className="text-xs text-buzz-mute mb-3">
                Searches every artist page in the directory that hasn't been claimed by
                a user yet. Selecting one sets it as theirs and they'll see it on their
                dashboard immediately.
              </p>
              <input
                className="input mb-3"
                placeholder="Type the artist or band name…"
                value={assignQuery}
                onChange={(e) => setAssignQuery(e.target.value)}
                autoFocus
              />
              {assignSearching && (
                <p className="text-xs text-buzz-mute">Searching…</p>
              )}
              {!assignSearching && assignResults && assignResults.length === 0 && assignQuery.trim().length >= 2 && (
                <p className="text-xs text-buzz-mute">
                  No unclaimed pages match "{assignQuery}". Try a shorter query, or hit
                  "+ Create artist page" instead.
                </p>
              )}
              {!assignSearching && assignResults && assignResults.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {assignResults.map((r) => (
                    <li
                      key={r.id}
                      className="rounded-lg border border-buzz-border bg-buzz-bg/50 p-3 flex items-center gap-3"
                    >
                      {r.image_url ? (
                        <div
                          className="w-12 h-12 rounded bg-buzz-surface shrink-0 border border-buzz-border"
                          style={{
                            backgroundImage: `url(${r.image_url})`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                          }}
                        />
                      ) : (
                        <div className="w-12 h-12 rounded bg-buzz-surface shrink-0 border border-buzz-border grid place-items-center text-xl">
                          🎤
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-display text-sm uppercase truncate">
                          {r.name}
                        </div>
                        <div className="text-xs text-buzz-mute">
                          /{r.slug}
                          {r.recent_event_count > 0 && (
                            <> · {r.recent_event_count} recent gig{r.recent_event_count === 1 ? "" : "s"}</>
                          )}
                        </div>
                      </div>
                      <Link
                        href={`/artists/${r.slug}`}
                        target="_blank"
                        className="text-xs text-buzz-mute hover:text-buzz-accent"
                      >
                        Preview ↗
                      </Link>
                      <button
                        type="button"
                        onClick={() => onAssign(r.id)}
                        disabled={assignBusyId === r.id || creatingArtist}
                        className="btn-primary text-xs whitespace-nowrap"
                      >
                        {assignBusyId === r.id ? "Assigning…" : "Assign"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {artists.length === 0 ? (
            <div className="card p-6 text-buzz-mute">
              No artist page yet. Create one and they'll appear in the public artist
              directory and be able to edit their bio + socials from their dashboard.
            </div>
          ) : (
            <ul className="card divide-y divide-buzz-border/60">
              {artists.map((a) => (
                <li key={a.id} className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-display text-lg uppercase truncate">
                      {a.name}{" "}
                      {a.approved ? (
                        <span className="text-xs text-emerald-400 normal-case font-sans">· Live</span>
                      ) : (
                        <span className="text-xs text-buzz-accent normal-case font-sans">· Pending</span>
                      )}
                    </div>
                    <div className="text-xs text-buzz-mute">/artists/{a.slug}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {a.approved && (
                      <Link href={`/artists/${a.slug}`} target="_blank" className="btn-secondary">
                        View ↗
                      </Link>
                    )}
                    <Link href={`/dashboard/artist/${a.id}/edit`} className="btn-secondary">
                      Edit page
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!isArtistRole && (
        <section>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="font-display text-xl uppercase">
              Their venues <span className="text-buzz-mute text-sm font-normal">({venues.length})</span>
            </h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowAssignVenue((v) => !v);
                  setError(null);
                }}
                className="btn-secondary"
              >
                {showAssignVenue ? "Cancel" : "🔗 Assign existing venue"}
              </button>
              <Link href={`/admin/users/${target.id}/new-venue`} className="btn-primary">
                + Add venue for this user
              </Link>
            </div>
          </div>
          {showAssignVenue && (
            <div className="card p-5 mb-3 border-buzz-accent/40">
              <p className="eyebrow text-buzz-accent text-[10px]">Assign existing</p>
              <h3 className="font-display text-lg mb-2">
                Pick a venue to assign to this user
              </h3>
              <p className="text-xs text-buzz-mute mb-3">
                Searches every venue in the directory. If a match has an owner already
                listed, assigning will transfer ownership to this user.
              </p>
              <input
                className="input mb-3"
                placeholder="Type the venue name…"
                value={venueQuery}
                onChange={(e) => setVenueQuery(e.target.value)}
                autoFocus
              />
              {venueSearching && <p className="text-xs text-buzz-mute">Searching…</p>}
              {!venueSearching && venueResults && venueResults.length === 0 && venueQuery.trim().length >= 2 && (
                <p className="text-xs text-buzz-mute">
                  No venues match "{venueQuery}". Try a shorter query, or use "+ Add venue" to create one.
                </p>
              )}
              {!venueSearching && venueResults && venueResults.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {venueResults.map((v) => (
                    <li
                      key={v.id}
                      className="rounded-lg border border-buzz-border bg-buzz-bg/50 p-3 flex items-center gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-display text-sm uppercase truncate">
                          {v.name}{" "}
                          {v.approved ? (
                            <span className="text-xs text-emerald-400 normal-case font-sans">· Live</span>
                          ) : (
                            <span className="text-xs text-buzz-accent normal-case font-sans">· Pending</span>
                          )}
                        </div>
                        <div className="text-xs text-buzz-mute truncate">
                          {v.cityName ?? "—"}
                          {v.currentOwnerId && (
                            <>
                              {" · currently owned by "}
                              <span className="text-orange-400">
                                {v.currentOwnerName || v.currentOwnerEmail || v.currentOwnerId.slice(0, 8)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {v.approved && v.citySlug && (
                        <Link
                          href={`/${v.citySlug}/venues/${v.slug}`}
                          target="_blank"
                          className="text-xs text-buzz-mute hover:text-buzz-accent"
                        >
                          Preview ↗
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={() => onAssignVenue(v.id)}
                        disabled={venueBusyId === v.id || reassigning}
                        className="btn-primary text-xs whitespace-nowrap"
                      >
                        {venueBusyId === v.id ? "Assigning…" : "Assign"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {venues.length === 0 ? (
            <div className="card p-6 text-buzz-mute">No venues attached to this user yet.</div>
          ) : (
            <ul className="card divide-y divide-buzz-border/60">
              {venues.map((v) => (
                <li key={v.id} className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-display text-lg uppercase truncate">
                      {v.name}{" "}
                      {v.approved ? (
                        <span className="text-xs text-emerald-400 normal-case font-sans">· Live</span>
                      ) : (
                        <span className="text-xs text-buzz-accent normal-case font-sans">· Pending</span>
                      )}
                    </div>
                    <div className="text-xs text-buzz-mute">{v.city?.name ?? "—"}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {v.approved && v.city?.slug && (
                      <Link href={`/${v.city.slug}/venues/${v.slug}`} target="_blank" className="btn-secondary">
                        View ↗
                      </Link>
                    )}
                    <Link href={`/dashboard/venues/${v.id}/edit`} className="btn-secondary">
                      Edit venue
                    </Link>
                    <select
                      defaultValue=""
                      disabled={reassigning}
                      onChange={(e) => {
                        const val = e.target.value;
                        e.target.value = "";
                        if (val) onReassign(v.id, val);
                      }}
                      className="input max-w-[220px] py-1.5"
                      aria-label="Reassign venue to another owner"
                    >
                      <option value="">Reassign to…</option>
                      {otherOwners.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.display_name || o.email || o.id.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
