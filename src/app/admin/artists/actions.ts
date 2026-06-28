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
  return { supabase };
}

export async function setArtistApproval(artistId: string, approved: boolean) {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised." };
  const { error } = await ctx.supabase.from("artists").update({ approved }).eq("id", artistId);
  if (error) return { error: error.message };
  revalidatePath("/admin/artists");
  return { ok: true };
}

/**
 * Hard-delete an artist row and every link that depends on it.
 *
 * Previous implementation called `from("artists").delete()` with the
 * user-auth client. Two problems:
 *   1. RLS on `artists` blocks the delete unless a specific admin
 *      policy exists; depending on the policy state, this would either
 *      silently no-op or return a permission error.
 *   2. Even with a delete policy, FK rows in event_artists,
 *      festival_lineup, favourites, and artist_claims would block the
 *      delete with a foreign-key violation. The schema doesn't
 *      uniformly cascade these (event_artists does, but festival_lineup
 *      and favourites typically don't).
 *
 * Fix: use the service client (admin trust decision made in
 * requireAdmin above) and pre-delete every linked row in dependency
 * order before deleting the artist itself. Best-effort on each linked
 * table — we don't want a missing-table error (e.g. festival_lineup
 * on a deploy that hasn't run sql/056 yet) to block the main delete.
 */
export async function deleteArtistFromList(artistId: string) {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised." };
  const sb = createServiceClient();

  // 1. Event-artist links — usually cascades via FK but be explicit so
  //    we don't depend on schema state.
  try { await sb.from("event_artists").delete().eq("artist_id", artistId); } catch { /* table may not exist on legacy deploys */ }

  // 2. Festival lineup (sql/056) — does NOT cascade in older schema.
  try { await sb.from("festival_lineup").delete().eq("artist_id", artistId); } catch { /* sql/056 may not be applied */ }

  // 3. Favourites — anyone who hearted this artist. No FK on most
  //    deployments, so this is essential cleanup.
  try { await sb.from("favourites").delete().eq("target_type", "artist").eq("target_id", artistId); } catch { /* legacy */ }

  // 4. Artist claims — pending or resolved claims for this artist.
  //    Leaves the claimer's user account intact; only the claim row
  //    disappears.
  try { await sb.from("artist_claims").delete().eq("artist_id", artistId); } catch { /* legacy */ }

  // 5. The artist itself.
  const { error } = await sb.from("artists").delete().eq("id", artistId);
  if (error) return { error: error.message };

  revalidatePath("/admin/artists");
  return { ok: true };
}
