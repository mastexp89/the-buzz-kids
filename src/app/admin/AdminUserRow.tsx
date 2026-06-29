"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setUserRole } from "./actions";

function roleLabel(role: string): string {
  switch (role) {
    case "admin": return "super admin";
    case "editor": return "editor";
    case "venue_owner": return "place owner";
    case "artist": return "artist";
    case "event_organiser": return "organiser";
    case "user": return "user";
    default: return role;
  }
}

export default function AdminUserRow({
  user,
  isCurrentUser,
  venueCount = 0,
}: {
  user: { id: string; email: string | null; display_name: string | null; role: string };
  isCurrentUser: boolean;
  venueCount?: number;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();

  function promote() {
    if (!confirm(`Make ${user.email} a SUPER ADMIN? They'll be able to do everything — approvals, users, deletes, settings.`)) return;
    start(async () => {
      await setUserRole(user.id, "admin");
      router.refresh();
    });
  }

  function makeEditor() {
    if (!confirm(`Make ${user.email} an EDITOR? They can add places and events (auto-approved) and nothing else.`)) return;
    start(async () => {
      await setUserRole(user.id, "editor");
      router.refresh();
    });
  }

  function demote() {
    if (!confirm(`Remove staff role from ${user.email}?`)) return;
    start(async () => {
      await setUserRole(user.id, "venue_owner");
      router.refresh();
    });
  }

  return (
    <li className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
      <Link href={`/admin/users/${user.id}`} className="min-w-0 flex-1 group">
        <div className="font-medium truncate group-hover:text-buzz-accent transition">
          {user.display_name || <span className="text-buzz-mute">— no name —</span>}
          {isCurrentUser && <span className="ml-2 text-xs text-buzz-accent">(you)</span>}
        </div>
        <div className="text-xs text-buzz-mute truncate">
          {user.email}
          {venueCount > 0 && (
            <span className="ml-2">· {venueCount} {venueCount === 1 ? "venue" : "venues"}</span>
          )}
        </div>
      </Link>
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`chip ${
            user.role === "admin"
              ? "chip-accent"
              : user.role === "venue_owner"
              ? ""
              : "opacity-60"
          }`}
        >
          {roleLabel(user.role)}
        </span>
        <Link href={`/admin/users/${user.id}`} className="btn-secondary">
          View / edit
        </Link>
        {user.role === "admin" ? (
          <button onClick={demote} disabled={busy || isCurrentUser} className="btn-secondary">
            {busy ? "…" : "Remove admin"}
          </button>
        ) : user.role === "editor" ? (
          <>
            <button onClick={promote} disabled={busy} className="btn-secondary">{busy ? "…" : "Make super admin"}</button>
            <button onClick={demote} disabled={busy} className="btn-secondary">{busy ? "…" : "Remove editor"}</button>
          </>
        ) : (
          <>
            <button onClick={makeEditor} disabled={busy} className="btn-secondary">{busy ? "…" : "Make editor"}</button>
            <button onClick={promote} disabled={busy} className="btn-primary">{busy ? "…" : "Make super admin"}</button>
          </>
        )}
      </div>
    </li>
  );
}
