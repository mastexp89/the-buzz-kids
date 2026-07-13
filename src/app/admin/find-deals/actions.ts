"use server";

import { createClient } from "@/lib/supabase/server";
import { runDealSweep, type DealSweepResult } from "@/lib/deal-sweep";
import { revalidatePath } from "next/cache";

async function requireAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return prof?.role === "admin";
}

export async function runFindDeals(urls: string[], dry: boolean): Promise<DealSweepResult> {
  const empty: DealSweepResult = {
    ok: false, dry, urlsTried: 0, pagesRead: 0, found: 0,
    duplicates: 0, inserted: 0, samples: [], warnings: [], error: "Admins only.",
  };
  if (!(await requireAdmin())) return empty;
  const res = await runDealSweep(urls, dry);
  if (!dry && res.inserted > 0) revalidatePath("/admin/offers");
  return res;
}
