// Staff role tiers.
//
//   'admin'  — super admin (Dylan, David). Full Control Room: approvals,
//              users, offers, cron, deletes, everything.
//   'editor' — restricted contributor. Can add places and events (which
//              auto-approve), and nothing else. No access to the rest of
//              the admin tools.
//
// Everyone else ('venue_owner' / 'organiser' / 'fan' / etc.) is a normal user.

export function isSuperAdmin(role: string | null | undefined): boolean {
  return role === "admin";
}

export function isEditor(role: string | null | undefined): boolean {
  return role === "editor";
}

// Can use the place/event creation forms (admins + editors).
export function canContribute(role: string | null | undefined): boolean {
  return role === "admin" || role === "editor";
}
