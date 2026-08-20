"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return null;
  return { userId: user.id };
}

export type SaveResult = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * Store a venue's Facebook Page ID so the daily FB roundup can @-tag it.
 * Accepts a bare numeric ID or a pasted URL containing one; blank clears it.
 */
export async function setVenueFacebookPageId(venueId: string, raw: string): Promise<SaveResult> {
  if (!(await requireAdmin())) return { ok: false, error: "Admins only." };

  const input = (raw ?? "").trim();
  let value: string | null = null;
  if (input) {
    // Be forgiving: admins paste all sorts (bare id, profile.php?id=…,
    // /pages/Name/<id>). Pull the first long number out of any of them.
    const m = input.match(/(\d{6,})/);
    if (!m) return { ok: false, error: "That doesn't contain a Page ID (a long number)." };
    value = m[1];
  }

  const sb = createServiceClient();
  const { error } = await sb.from("venues").update({ facebook_page_id: value }).eq("id", venueId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/venue-fb-ids");
  return { ok: true, value };
}

export type VenueRow = {
  id: string; name: string; facebook: string | null; facebook_page_id: string | null; city: string | null;
};

/** Search venues by name so admins can find one to tag without endless scrolling. */
export async function searchVenues(query: string): Promise<VenueRow[]> {
  if (!(await requireAdmin())) return [];
  const sb = createServiceClient();
  let q = sb
    .from("venues")
    .select("id, name, facebook, facebook_page_id, city:cities(name)")
    .eq("approved", true)
    .order("name")
    .limit(40);
  const term = (query ?? "").trim();
  if (term) q = q.ilike("name", `%${term}%`);
  else q = q.not("facebook", "is", null); // default view: ones we have a FB link for
  const { data } = await q;
  return (data ?? []).map((v: any) => ({
    id: v.id, name: v.name, facebook: v.facebook,
    facebook_page_id: v.facebook_page_id, city: v.city?.name ?? null,
  }));
}
