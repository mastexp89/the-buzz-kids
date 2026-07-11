"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { CIRCUS } from "@/lib/competition";

async function isAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return me?.role === "admin" ? user.id : null;
}

// Admin: remove an entrant from the draw (e.g. your own test accounts).
export async function removeCircusEntry(formData: FormData): Promise<void> {
  if (!(await isAdmin())) return;
  const userId = String(formData.get("user_id") ?? "");
  if (!userId) return;
  const sb = createServiceClient();
  await sb.from("competition_entries").delete()
    .eq("competition_slug", CIRCUS.slug).eq("user_id", userId);
  revalidatePath("/admin/competition");
}

export type DrawResult = { ok: boolean; winner?: { name: string | null; email: string | null }; entries?: number; message?: string };

// Admin: draw a random winner from confirmed entries.
export async function drawCircusWinner(): Promise<DrawResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") return { ok: false, message: "Admins only." };

  const sb = createServiceClient();
  const { data: entries } = await sb
    .from("competition_entries").select("user_id").eq("competition_slug", CIRCUS.slug);
  if (!entries || entries.length === 0) return { ok: false, message: "No entries yet." };

  const winnerId = entries[Math.floor(Math.random() * entries.length)].user_id;
  const { data: prof } = await sb.from("profiles").select("display_name").eq("id", winnerId).maybeSingle();
  let email: string | null = null;
  try {
    const { data: authUser } = await sb.auth.admin.getUserById(winnerId);
    email = authUser?.user?.email ?? null;
  } catch { /* best effort */ }

  return { ok: true, winner: { name: prof?.display_name ?? null, email }, entries: entries.length };
}
