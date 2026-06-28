"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: me } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") return null;
  return { supabase };
}

/**
 * Mark this venue as having been DM'd via outreach. Sets the timestamp
 * to now; unmarking sets it back to null.
 */
export async function setVenueMessaged(
  venueId: string,
  messaged: boolean,
): Promise<{ ok: true; at: string | null } | { error: string }> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };

  const at = messaged ? new Date().toISOString() : null;
  const { error } = await ctx.supabase
    .from("venues")
    .update({ outreach_messaged_at: at })
    .eq("id", venueId);
  if (error) return { error: error.message };

  revalidatePath("/admin/venue-outreach");
  return { ok: true, at };
}
