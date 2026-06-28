"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setUserRole } from "./actions";

function roleLabel(role: string): string {
  switch (role) {
    case "admin": return "admin";
    case "venue_owner": return "venue";
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
    if (!confirm(`Make ${user.email} an admin? They'll be able to approve venues and manage other admins.`)) return;
    start(async () => {
      await setUserRole(user.id, "admin");
      router.refresh();
    });
  }

  function demote() {
    if (!confirm(`Remove admin from ${user.email}?`)) return;
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
        ) : (
          <button onClick={promote} disabled={busy} className="btn-primary">
            {busy ? "…" : "Make admin"}
          </button>
        )}
      </div>
    </li>
  );
}
