"use server";

// Admin-only server actions for the venue edit page. Currently:
//   - adminDeleteEvent: hard-deletes an event from a venue. Cascades event_artists / event_genres.
//
// Permissions: actor must have profiles.role = 'admin'. We don't allow venue
// owners to delete events here — they can use the existing per-event edit flow
// (which sets cancelled/rejected statuses) for their own data integrity.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

export type AdminDeleteEventResult = { ok: true } | { error: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return null;
  return { userId: user.id };
}

export async function adminDeleteEvent(opts: {
  eventId: string;
  venueId: string;
}): Promise<AdminDeleteEventResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };

  const sb = createServiceClient();

  // Sanity check: event belongs to this venue
  const { data: ev } = await sb
    .from("events")
    .select("id, venue_id, venue:venues(slug, city:cities(slug))")
    .eq("id", opts.eventId)
    .maybeSingle();
  if (!ev) return { error: "Event not found." };
  if (ev.venue_id !== opts.venueId) return { error: "Event doesn't belong to this venue." };

  // Cascade-delete linked rows. (FKs may already cascade; doing it explicitly
  // keeps things predictable across environments.)
  await sb.from("event_artists").delete().eq("event_id", opts.eventId);
  await sb.from("event_genres").delete().eq("event_id", opts.eventId);

  const { error } = await sb.from("events").delete().eq("id", opts.eventId);
  if (error) return { error: `Delete failed: ${error.message}` };

  // Revalidate public + dashboard pages so the deletion is visible immediately.
  const citySlug = (ev.venue as any)?.city?.slug ?? "dundee";
  const venueSlug = (ev.venue as any)?.slug;
  if (venueSlug) revalidatePath(`/${citySlug}/venues/${venueSlug}`);
  revalidatePath(`/${citySlug}`);
  revalidatePath(`/dashboard/venues/${opts.venueId}`);
  revalidatePath(`/dashboard/venues/${opts.venueId}/edit`);
  revalidatePath("/admin/queue");

  return { ok: true };
}
