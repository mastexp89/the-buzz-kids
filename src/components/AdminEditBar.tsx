// Floating admin "Edit" bar — appears in the bottom-right of any public
// page when an admin is signed in. Lets admins jump to the edit screen for
// whatever they're looking at without having to navigate via the admin panel.
//
// Server component: checks role server-side, renders nothing for non-admins.
// Drop it on a public page like:
//   <AdminEditBar editHref={`/dashboard/venues/${venue.id}/edit`} label="Edit venue" />

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function AdminEditBar({
  editHref,
  label,
  extraLinks = [],
}: {
  editHref: string;
  label: string;
  // Optional extra admin shortcuts (e.g. "View in queue", "Promote", "Delete")
  extraLinks?: { href: string; label: string; danger?: boolean }[];
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (prof?.role !== "admin") return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 print:hidden">
      <Link
        href={editHref}
        className="inline-flex items-center gap-2 px-4 py-3 rounded-full bg-buzz-accent text-black font-bold text-sm shadow-lg hover:scale-105 transition"
      >
        ✏️ {label}
      </Link>
      {extraLinks.length > 0 && (
        <div className="flex flex-col items-end gap-1.5">
          {extraLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium shadow ${
                l.danger
                  ? "bg-rose-500/90 text-white hover:bg-rose-500"
                  : "bg-buzz-card border border-buzz-border text-buzz-text hover:border-buzz-accent"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
