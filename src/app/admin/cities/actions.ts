"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return null;
  return { userId: user.id };
}

export type SetCityActiveResult =
  | { ok: true; slug: string; active: boolean }
  | { error: string };

/**
 * Flip a city's active flag. Affects:
 *   - Whether /<slug> renders publicly (inactive → 404)
 *   - Whether the navbar / footer city pickers include it
 *   - Whether the homepage shows it in the hero buttons
 *   - Whether the "Filter by city" pills on /admin show it
 *
 * Admin-only. Idempotent.
 */
export async function setCityActive(
  slug: string,
  active: boolean,
): Promise<SetCityActiveResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };

  const sb = createServiceClient();
  const { error } = await sb
    .from("cities")
    .update({ active })
    .eq("slug", slug);
  if (error) return { error: error.message };

  // Revalidate everywhere the active flag matters.
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath(`/${slug}`);
  return { ok: true, slug, active };
}
