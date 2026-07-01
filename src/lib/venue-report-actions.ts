"use server";

// Public "report an issue" for a place — a parent flags it as closed / moved /
// wrong. Mirrors the offers "Not on anymore?" tally: bump a counter + store the
// latest reason, so admins can spot places worth re-checking. Uses the service
// client so anonymous visitors can report without an RLS write policy.

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

export async function reportVenue(venueId: string, reason: string): Promise<{ ok?: true; error?: string }> {
  if (!venueId) return { error: "Missing place." };
  const sb = createServiceClient();
  const { data } = await sb.from("venues").select("reports").eq("id", venueId).maybeSingle();
  if (!data) return { error: "Place not found." };
  const { error } = await sb
    .from("venues")
    .update({
      reports: (data.reports ?? 0) + 1,
      last_reported_at: new Date().toISOString(),
      report_note: (reason || "").slice(0, 200),
    })
    .eq("id", venueId);
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}
