"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const STATUSES = ["not_contacted", "contacted", "interested", "onboarded", "rejected"] as const;
const TYPES = ["bar", "pub", "club", "venue", "hotel", "theatre", "restaurant", "other"] as const;

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, ok: false as const, userId: null };
  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  return { supabase, ok: profile?.role === "admin", userId: user.id };
}

function clean(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

export async function createProspect(formData: FormData) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };

  const name = clean(formData.get("name"));
  if (!name) return { error: "Name is required." };

  const type = String(formData.get("type") ?? "bar");
  if (!TYPES.includes(type as any)) return { error: "Invalid type." };

  const city_id = clean(formData.get("city_id"));

  const { error } = await supabase.from("prospects").insert({
    name,
    type,
    city_id,
    address: clean(formData.get("address")),
    postcode: clean(formData.get("postcode")),
    phone: clean(formData.get("phone")),
    email: clean(formData.get("email")),
    website: clean(formData.get("website")),
    instagram: clean(formData.get("instagram")),
    facebook: clean(formData.get("facebook")),
    notes: clean(formData.get("notes")),
    status: "not_contacted",
  });

  if (error) return { error: error.message };
  revalidatePath("/admin/outreach");
  return { ok: true };
}

export async function updateProspect(id: string, formData: FormData) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };

  const name = clean(formData.get("name"));
  if (!name) return { error: "Name is required." };

  const type = String(formData.get("type") ?? "bar");
  if (!TYPES.includes(type as any)) return { error: "Invalid type." };

  const status = String(formData.get("status") ?? "not_contacted");
  if (!STATUSES.includes(status as any)) return { error: "Invalid status." };

  const { error } = await supabase
    .from("prospects")
    .update({
      name,
      type,
      city_id: clean(formData.get("city_id")),
      address: clean(formData.get("address")),
      postcode: clean(formData.get("postcode")),
      phone: clean(formData.get("phone")),
      email: clean(formData.get("email")),
      website: clean(formData.get("website")),
      instagram: clean(formData.get("instagram")),
      facebook: clean(formData.get("facebook")),
      notes: clean(formData.get("notes")),
      status,
    })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/admin/outreach");
  return { ok: true };
}

export async function setProspectStatus(id: string, status: string) {
  const { supabase, ok, userId } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };
  if (!STATUSES.includes(status as any)) return { error: "Invalid status." };

  // Stamp last_contacted_at when transitioning into "contacted" / "interested"
  const stamp = (status === "contacted" || status === "interested")
    ? { last_contacted_at: new Date().toISOString(), last_contacted_by: userId }
    : {};

  const { error } = await supabase
    .from("prospects")
    .update({ status, ...stamp })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/admin/outreach");
  return { ok: true };
}

export async function logContact(id: string) {
  const { supabase, ok, userId } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };

  const { error } = await supabase
    .from("prospects")
    .update({
      last_contacted_at: new Date().toISOString(),
      last_contacted_by: userId,
      // If still "not_contacted", bump to "contacted"
      status: "contacted",
    })
    .eq("id", id)
    .eq("status", "not_contacted");

  // If they were already past "contacted", just stamp the timestamp
  if (!error) {
    await supabase
      .from("prospects")
      .update({ last_contacted_at: new Date().toISOString(), last_contacted_by: userId })
      .eq("id", id)
      .neq("status", "not_contacted");
  }

  revalidatePath("/admin/outreach");
  return { ok: true };
}

export async function deleteProspect(id: string) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };
  const { error } = await supabase.from("prospects").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/outreach");
  return { ok: true };
}
