"use server";

// Admin-only event utilities. Currently:
//   - moveEventToVenue: re-assign an event to a different venue. Used when
//     an event was scraped/imported under the wrong venue, or when artist-
//     submitted gigs need correcting.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return null;
  return { userId: user.id };
}

export type MoveEventResult =
  | { ok: true; newVenueId: string; newVenueSlug: string }
  | { error: string };

export async function moveEventToVenue(opts: {
  eventId: string;
  newVenueId: string;
}): Promise<MoveEventResult> {
  if (!(await requireAdmin())) return { error: "Admins only." };

  const sb = createServiceClient();

  // Sanity: confirm both event and target venue exist
  const [{ data: event }, { data: newVenue }] = await Promise.all([
    sb.from("events")
      .select("id, venue_id, venue:venues(slug, city:cities(slug))")
      .eq("id", opts.eventId)
      .maybeSingle(),
    sb.from("venues")
      .select("id, slug, city:cities(slug)")
      .eq("id", opts.newVenueId)
      .maybeSingle(),
  ]);
  if (!event) return { error: "Event not found." };
  if (!newVenue) return { error: "Target venue not found." };
  if (event.venue_id === opts.newVenueId) {
    return { ok: true, newVenueId: opts.newVenueId, newVenueSlug: newVenue.slug };
  }

  const { error } = await sb
    .from("events")
    .update({ venue_id: opts.newVenueId })
    .eq("id", opts.eventId);
  if (error) return { error: `Move failed: ${error.message}` };

  // Revalidate both old + new venue pages so they reflect the change immediately
  const oldCitySlug = (event.venue as any)?.city?.slug ?? "dundee";
  const oldVenueSlug = (event.venue as any)?.slug;
  const newCitySlug = (newVenue.city as any)?.slug ?? "dundee";
  if (oldVenueSlug) revalidatePath(`/${oldCitySlug}/venues/${oldVenueSlug}`);
  revalidatePath(`/${newCitySlug}/venues/${newVenue.slug}`);
  revalidatePath(`/${oldCitySlug}`);
  revalidatePath(`/${newCitySlug}`);
  revalidatePath(`/${newCitySlug}/events/${opts.eventId}`);
  revalidatePath("/admin/queue");

  return { ok: true, newVenueId: opts.newVenueId, newVenueSlug: newVenue.slug };
}

// Lightweight venue search for the move-event picker. Admin-only.
export type MoveVenueOption = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
};

export async function searchVenuesForMove(query: string): Promise<MoveVenueOption[]> {
  if (!(await requireAdmin())) return [];
  const sb = createServiceClient();
  const q = query.trim();
  let req = sb
    .from("venues")
    .select("id, name, slug, city:cities(name)")
    .order("name")
    .limit(15);
  if (q.length > 0) req = req.ilike("name", `%${q.replace(/[%_]/g, "")}%`);
  const { data } = await req;
  return (data ?? []).map((v: any) => ({
    id: v.id,
    name: v.name,
    slug: v.slug,
    city: v.city?.name ?? null,
  }));
}
