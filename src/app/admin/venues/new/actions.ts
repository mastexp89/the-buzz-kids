"use server";

// Manually create a single venue as admin. Different from:
//   • /admin/discover-venues — bulk-finds venues via Google Maps
//   • /admin/queue (suggestions tab) — accepts user-submitted suggestions
//
// This one is for when admin spots a venue that's neither in OSM/Maps
// nor user-suggested but needs to be on the site (e.g. a private hire
// space, a pop-up bar, a community hall hosting gigs).
//
// Auto-approves (admins know what they're doing) and tries postcode
// geocoding so the venue lands on the map without extra steps.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { slugify } from "@/lib/utils";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  // Editors (restricted contributors) can add places too — auto-approved.
  if (prof?.role !== "admin" && prof?.role !== "editor") return null;
  return { userId: user.id };
}

export type CreateVenueAsAdminInput = {
  name: string;
  cityId: string;
  address?: string;
  postcode?: string;
  facebook?: string;
  website?: string;
  phone?: string;
};

export type CreateVenueAsAdminResult =
  | {
      ok: true;
      venueId: string;
      venueSlug: string;
      citySlug: string;
      geocoded: boolean;
    }
  | { error: string };

export async function createVenueAsAdmin(
  input: CreateVenueAsAdminInput,
): Promise<CreateVenueAsAdminResult> {
  if (!(await requireAdmin())) return { error: "Admins only." };

  const name = (input.name ?? "").trim();
  if (!name) return { error: "Name is required." };
  if (name.length > 200) return { error: "Name too long (max 200 chars)." };
  if (!input.cityId) return { error: "City is required." };

  const sb = createServiceClient();

  // Resolve the city — fail fast if the id doesn't exist (catches a
  // client sending stale dropdown data after a city was deleted).
  const { data: city } = await sb
    .from("cities")
    .select("id, slug")
    .eq("id", input.cityId)
    .maybeSingle();
  if (!city) return { error: "Selected city not found." };

  // Optional postcode → lat/lng via postcodes.io (free, UK-only).
  // Best-effort: a failed geocode shouldn't block venue creation.
  let latitude: number | null = null;
  let longitude: number | null = null;
  let geocoded = false;
  const postcode = input.postcode?.trim() || null;
  if (postcode) {
    try {
      const { geocodePostcode } = await import("@/lib/geocode");
      const ll = await geocodePostcode(postcode);
      if (ll) {
        latitude = ll.lat;
        longitude = ll.lng;
        geocoded = true;
      }
    } catch {
      // Postcode lookup failed — venue still gets created without coords.
    }
  }

  // Generate a unique slug. We retry up to 5 times with numeric suffixes
  // in case the base slug collides with an existing venue.
  const baseSlug = slugify(name) || "venue";
  let slug = baseSlug;
  let venueId: string | null = null;
  for (let i = 0; i < 5 && !venueId; i++) {
    const { data: created, error } = await sb
      .from("venues")
      .insert({
        name,
        slug,
        city_id: city.id,
        address: input.address?.trim() || null,
        postcode,
        facebook: input.facebook?.trim() || null,
        website: input.website?.trim() || null,
        phone: input.phone?.trim() || null,
        latitude,
        longitude,
        // Admin-created venues are pre-approved — no queue trip.
        approved: true,
      })
      .select("id")
      .single();
    if (created) {
      venueId = created.id;
      break;
    }
    // Postgres unique-violation → bump the slug suffix and retry.
    if (error?.code === "23505") {
      slug = `${baseSlug}-${i + 2}`;
      continue;
    }
    return { error: `Insert failed: ${error?.message ?? "unknown"}` };
  }
  if (!venueId) return { error: "Couldn't find a free slug for this venue." };

  // Revalidate everywhere it might appear so it shows up immediately.
  revalidatePath(`/${city.slug}`);
  revalidatePath(`/${city.slug}/venues/${slug}`);
  revalidatePath("/admin");

  return {
    ok: true,
    venueId,
    venueSlug: slug,
    citySlug: city.slug,
    geocoded,
  };
}
