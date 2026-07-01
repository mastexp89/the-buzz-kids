"use server";

// Admin actions for the edit_suggestions review queue.

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

export async function setSuggestionStatus(
  id: string,
  status: "new" | "done",
): Promise<{ ok?: true; error?: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();
  const { error } = await sb.from("edit_suggestions").update({ status }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/suggestions");
  revalidatePath("/admin");
  return { ok: true };
}

export async function deleteSuggestion(id: string): Promise<{ ok?: true; error?: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();
  const { error } = await sb.from("edit_suggestions").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/suggestions");
  revalidatePath("/admin");
  return { ok: true };
}
