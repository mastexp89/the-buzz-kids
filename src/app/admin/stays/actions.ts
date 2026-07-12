"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ingestStaysForArea, type StaysIngestResult } from "@/lib/stays-ingest";
import { revalidatePath } from "next/cache";

async function requireAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return prof?.role === "admin";
}

export async function runStaysIngest(area: string, dry: boolean): Promise<StaysIngestResult> {
  const empty: StaysIngestResult = {
    ok: false, dry, area, raw: 0, kept: 0, rejected: 0, wrongArea: 0,
    counts: { glamping: 0, caravan: 0, cottage: 0, hotel: 0 },
    inserted: 0, samples: [], warnings: [], error: "Admins only.",
  };
  if (!(await requireAdmin())) return empty;
  if (!area?.trim()) return { ...empty, error: "Pick an area." };
  const res = await ingestStaysForArea(area.trim(), { dry });
  if (!dry) revalidatePath("/admin/stays");
  return res;
}

export async function deleteStay(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const id = String(formData.get("id") || "");
  if (!id) return;
  const sb = createServiceClient();
  await sb.from("stays").delete().eq("id", id);
  revalidatePath("/admin/stays");
}

export async function clearStaysForArea(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const citySlug = String(formData.get("city_slug") || "");
  if (!citySlug) return;
  const sb = createServiceClient();
  await sb.from("stays").delete().eq("city_slug", citySlug);
  revalidatePath("/admin/stays");
}
