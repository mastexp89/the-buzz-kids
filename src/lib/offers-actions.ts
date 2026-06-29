"use server";

// Public: a visitor flags an offer as "not on anymore". No auth — anyone can
// report. We just bump a counter + timestamp so admins can spot deals worth
// re-checking on the Offers admin page.
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

export async function reportOffer(offerId: string): Promise<{ ok?: true; error?: string }> {
  if (!offerId) return { error: "Missing offer." };
  const sb = createServiceClient();
  const { data } = await sb.from("offers").select("reports").eq("id", offerId).maybeSingle();
  if (!data) return { error: "Offer not found." };
  const { error } = await sb
    .from("offers")
    .update({ reports: (data.reports ?? 0) + 1, last_reported_at: new Date().toISOString() })
    .eq("id", offerId);
  if (error) return { error: error.message };
  revalidatePath("/admin/offers");
  return { ok: true };
}
