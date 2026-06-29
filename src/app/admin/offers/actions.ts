"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return prof?.role === "admin" ? user : null;
}

export type OfferResult = { ok?: true; error?: string };

export async function createOffer(formData: FormData): Promise<OfferResult> {
  if (!(await requireAdmin())) return { error: "Admins only." };

  const category = String(formData.get("category") ?? "");
  if (!["food", "days-out"].includes(category)) return { error: "Pick a category." };
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Give the offer a title." };

  const scope = String(formData.get("scope") ?? "national") === "local" ? "local" : "national";
  const cityId = String(formData.get("city_id") ?? "").trim() || null;

  const sb = createServiceClient();
  const { error } = await sb.from("offers").insert({
    category,
    title,
    provider: String(formData.get("provider") ?? "").trim() || null,
    description: String(formData.get("description") ?? "").trim() || null,
    terms: String(formData.get("terms") ?? "").trim() || null,
    url: String(formData.get("url") ?? "").trim() || null,
    scope,
    city_id: scope === "local" ? cityId : null,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/offers");
  revalidatePath("/browse");
  return { ok: true };
}

export async function deleteOffer(id: string): Promise<OfferResult> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();
  const { error } = await sb.from("offers").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/offers");
  revalidatePath("/browse");
  return { ok: true };
}
