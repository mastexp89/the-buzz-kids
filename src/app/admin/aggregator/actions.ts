"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runAggregatorImport, type AggregatorRunResult } from "@/lib/aggregator-ingest";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") throw new Error("Admins only.");
  return createServiceClient();
}

export async function addAggregatorSource(formData: FormData): Promise<void> {
  const sb = await requireAdmin();
  const url = String(formData.get("url") ?? "").trim();
  if (!/^https?:\/\//.test(url)) return;
  await sb.from("aggregator_sources").upsert(
    {
      url,
      label: String(formData.get("label") ?? "").trim() || null,
      city_slug: String(formData.get("city_slug") ?? "").trim().toLowerCase() || null,
      active: true,
    },
    { onConflict: "url", ignoreDuplicates: true },
  );
  revalidatePath("/admin/aggregator");
}

export async function deleteAggregatorSource(formData: FormData): Promise<void> {
  const sb = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (id) await sb.from("aggregator_sources").delete().eq("id", id);
  revalidatePath("/admin/aggregator");
}

export async function toggleAggregatorSource(formData: FormData): Promise<void> {
  const sb = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  if (id) await sb.from("aggregator_sources").update({ active }).eq("id", id);
  revalidatePath("/admin/aggregator");
}

export async function runAggregatorNow(dry: boolean): Promise<AggregatorRunResult> {
  await requireAdmin();
  // Keep the interactive batch small so a live run reliably finishes inside
  // the function timeout even when Anthropic throttles (429 retries add up).
  // The weekly cron (300s budget) chews through the bulk backlog; Run-now is
  // for a quick top-up.
  const result = await runAggregatorImport({ batch: dry ? 60 : 12, dry });
  revalidatePath("/admin/aggregator");
  return result;
}
