"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { restoreImageBatch, type RestoreBatchResult } from "@/lib/venue-images";
import { revalidatePath } from "next/cache";

async function requireAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return prof?.role === "admin";
}

export type RestoreRunResult = RestoreBatchResult & { ok: boolean; error?: string };

// One click = several batches inside the route's time budget. The client loops
// this until `remaining` hits 0, so a whole backfill is hands-off.
export async function runImageRestore(): Promise<RestoreRunResult> {
  const empty: RestoreRunResult = { ok: false, processed: 0, restored: 0, remaining: 0, failures: [], error: "Admins only." };
  if (!(await requireAdmin())) return empty;

  const sb = createServiceClient();
  const start = Date.now();
  let processed = 0, restored = 0, remaining = 0;
  const failures: { name: string; reason: string }[] = [];

  while (Date.now() - start < 200_000) {
    const r = await restoreImageBatch(sb, 12);
    processed += r.processed;
    restored += r.restored;
    remaining = r.remaining;
    failures.push(...r.failures);
    if (r.processed === 0) break;
  }

  if (restored > 0) revalidatePath("/");
  return { ok: true, processed, restored, remaining, failures: failures.slice(0, 40) };
}

// Clear the "already tried" mark on venues we still have no image for, so a
// fresh pass can retry them (e.g. after improving how we fetch).
export async function resetFailedAttempts(): Promise<{ ok: boolean; reset: number; error?: string }> {
  if (!(await requireAdmin())) return { ok: false, reset: 0, error: "Admins only." };
  const sb = createServiceClient();
  const { data, error } = await sb
    .from("venues")
    .update({ image_restore_attempt: null })
    .eq("approved", true)
    .is("cover_photo_url", null)
    .not("website", "is", null)
    .not("image_restore_attempt", "is", null)
    .select("id");
  if (error) return { ok: false, reset: 0, error: error.message };
  revalidatePath("/admin/restore-images");
  return { ok: true, reset: (data ?? []).length };
}
