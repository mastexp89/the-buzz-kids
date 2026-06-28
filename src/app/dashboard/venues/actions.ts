"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { slugify } from "@/lib/utils";
import { geocodePostcode } from "@/lib/geocode";
import { notifyNewVenue } from "@/lib/email";

async function isAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role === "admin";
}

export async function saveVenue(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const venueId = String(formData.get("venue_id") ?? "").trim() || null;
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const address = String(formData.get("address") ?? "").trim() || null;
  const postcode = String(formData.get("postcode") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const website = String(formData.get("website") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  const image_url = String(formData.get("image_url") ?? "").trim() || null;
  const logo_url = String(formData.get("logo_url") ?? "").trim() || null;
  const city_id = String(formData.get("city_id") ?? "").trim();
  const opening_hours = String(formData.get("opening_hours") ?? "").trim() || null;
  const ohJsonRaw = String(formData.get("opening_hours_json") ?? "").trim();
  let opening_hours_json: any = null;
  if (ohJsonRaw) {
    try { opening_hours_json = JSON.parse(ohJsonRaw); } catch { opening_hours_json = null; }
  }
  const instagram = String(formData.get("instagram") ?? "").trim() || null;
  const facebook = String(formData.get("facebook") ?? "").trim() || null;
  const twitter = String(formData.get("twitter") ?? "").trim() || null;
  const tiktok = String(formData.get("tiktok") ?? "").trim() || null;
  const spotify = String(formData.get("spotify") ?? "").trim() || null;
  const youtube = String(formData.get("youtube") ?? "").trim() || null;
  const gallery_image_urls = formData.getAll("gallery").map(String).filter(Boolean);

  // --- Kids' listing fields ---
  const intIn = (key: string, lo: number, hi: number): number | null => {
    const s = String(formData.get(key) ?? "").trim();
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(Math.max(lo, Math.min(hi, n))) : null;
  };
  const venue_type = (() => {
    const v = String(formData.get("venue_type") ?? "attraction").trim();
    return ["attraction", "programmes", "both"].includes(v) ? v : "attraction";
  })();
  const age_min = intIn("age_min", 0, 18);
  const age_max = intIn("age_max", 0, 18);
  const is_free = formData.get("is_free") === "on" || formData.get("is_free") === "true";
  const priceRaw = String(formData.get("price_from") ?? "").trim();
  const price_from = priceRaw === "" || !Number.isFinite(Number(priceRaw)) ? null : Math.max(0, Number(priceRaw));
  const price_note = String(formData.get("price_note") ?? "").trim() || null;
  const setting = (() => {
    const v = String(formData.get("setting") ?? "").trim();
    return ["indoor", "outdoor", "both"].includes(v) ? v : null;
  })();
  const booking_required = formData.get("booking_required") === "on" || formData.get("booking_required") === "true";
  const booking_url = String(formData.get("booking_url") ?? "").trim() || null;
  const accessibility = formData.getAll("accessibility").map(String).filter(Boolean);
  const categorySlugs = formData.getAll("category").map(String).filter(Boolean);
  const kidsFields = { venue_type, age_min, age_max, is_free, price_from, price_note, setting, booking_required, booking_url, accessibility };

  // Replace a venue's category tags (venue_genres) with the chosen slugs.
  async function syncCategories(client: any, vId: string, slugs: string[]) {
    await client.from("venue_genres").delete().eq("venue_id", vId);
    if (slugs.length === 0) return;
    const { data: gs } = await client.from("genres").select("id, slug").in("slug", slugs);
    if (gs && gs.length > 0) {
      await client.from("venue_genres").insert(gs.map((g: any) => ({ venue_id: vId, genre_id: g.id })));
    }
  }

  if (!name || !city_id) return { error: "Name and city are required." };

  // Geocode postcode → lat/long (UK only, free, no auth)
  let latitude: number | null = null;
  let longitude: number | null = null;
  if (postcode) {
    const geo = await geocodePostcode(postcode);
    if (geo) {
      latitude = geo.lat;
      longitude = geo.lng;
    }
  }

  // Admins can override the owner when creating venues on someone's behalf.
  // Ignored for everyone else.
  const ownerOverride = String(formData.get("owner_id_override") ?? "").trim() || null;

  if (venueId) {
    const { data: existing } = await supabase
      .from("venues")
      .select("id, owner_id, slug, city:cities(slug)")
      .eq("id", venueId)
      .single();
    if (!existing) return { error: "Venue not found." };
    const isAdminUser = await isAdmin(supabase, user.id);
    if (existing.owner_id !== user.id && !isAdminUser) {
      return { error: "Not authorised." };
    }

    // Slug change — admin only. Validate format + uniqueness.
    const proposedSlugRaw = String(formData.get("slug") ?? "").trim();
    let slugUpdate: string | null = null;
    if (proposedSlugRaw && isAdminUser) {
      const proposed = slugify(proposedSlugRaw);
      if (!proposed || proposed.length < 2) return { error: "Slug must be at least 2 characters." };
      if (proposed !== existing.slug) {
        const { data: clash } = await supabase
          .from("venues")
          .select("id")
          .eq("slug", proposed)
          .neq("id", venueId)
          .maybeSingle();
        if (clash) return { error: `Slug "${proposed}" is already taken by another venue.` };
        slugUpdate = proposed;
      }
    }

    const { error } = await supabase
      .from("venues")
      .update({
        name, description, address, postcode, phone, website, email,
        image_url, logo_url, city_id,
        opening_hours, opening_hours_json,
        instagram, facebook, twitter, tiktok, spotify, youtube,
        gallery_image_urls,
        latitude, longitude,
        ...kidsFields,
        ...(slugUpdate ? { slug: slugUpdate } : {}),
      })
      .eq("id", venueId);
    if (error) return { error: error.message };
    await syncCategories(supabase, venueId, categorySlugs);

    const citySlug = (existing.city as any)?.slug ?? "dundee";

    // Record a redirect so the old URL still works
    if (slugUpdate) {
      const sb = createServiceClient();
      // Unify any existing redirects pointing at the OLD slug → re-target them
      // to the NEW slug to avoid redirect chains
      await sb
        .from("slug_redirects")
        .update({ new_slug: slugUpdate })
        .eq("resource_type", "venue")
        .eq("city_slug", citySlug)
        .eq("new_slug", existing.slug);
      // Insert the new redirect
      await sb.from("slug_redirects").upsert(
        { resource_type: "venue", city_slug: citySlug, old_slug: existing.slug, new_slug: slugUpdate },
        { onConflict: "resource_type,city_slug,old_slug" },
      );
      // Drop a redirect FROM the new slug (would loop)
      await sb
        .from("slug_redirects")
        .delete()
        .eq("resource_type", "venue")
        .eq("city_slug", citySlug)
        .eq("old_slug", slugUpdate);
    }

    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/venues/${venueId}`);
    revalidatePath(`/dashboard/venues/${venueId}/edit`);
    // Revalidate both the old + new public venue URL if slug changed
    revalidatePath(`/${citySlug}/venues/${existing.slug}`);
    if (slugUpdate) revalidatePath(`/${citySlug}/venues/${slugUpdate}`);
    revalidatePath(`/${citySlug}`);
    return { ok: true };
  } else {
    const base = slugify(name);
    let slug = base;
    for (let i = 1; i < 50; i++) {
      const { data: clash } = await supabase.from("venues").select("id").eq("slug", slug).maybeSingle();
      if (!clash) break;
      slug = `${base}-${i + 1}`;
    }

    // If the current user is an admin and supplied an owner override, use that.
    let ownerId = user.id;
    if (ownerOverride && (await isAdmin(supabase, user.id))) {
      ownerId = ownerOverride;
    }

    const { data: created, error } = await supabase.from("venues").insert({
      owner_id: ownerId,
      city_id,
      name, slug, description, address, postcode, phone, website, email,
      image_url, logo_url,
      opening_hours, opening_hours_json,
      instagram, facebook, twitter, tiktok, spotify, youtube,
      gallery_image_urls,
      latitude, longitude,
      ...kidsFields,
    }).select("id").single();
    if (error) return { error: error.message };
    await syncCategories(supabase, created.id, categorySlugs);

    // Email admin so they can review the new venue
    const { data: cityRow } = await supabase.from("cities").select("name").eq("id", city_id).maybeSingle();
    notifyNewVenue({
      venueId: created.id,
      venueName: name,
      ownerEmail: user.email ?? null,
      cityName: cityRow?.name ?? null,
    }).catch(() => {});

    revalidatePath("/dashboard");
    return { ok: true, redirectTo: `/dashboard/venues/${created.id}` };
  }
}

export async function deleteVenue(venueId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: venue } = await supabase
    .from("venues")
    .select("owner_id")
    .eq("id", venueId)
    .single();
  if (!venue) return { error: "Venue not found." };
  if (venue.owner_id !== user.id && !(await isAdmin(supabase, user.id))) {
    return { error: "Not authorised." };
  }

  const { error } = await supabase.from("venues").delete().eq("id", venueId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  redirect("/dashboard");
}
