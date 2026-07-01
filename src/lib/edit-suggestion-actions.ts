"use server";

// Public "Suggest an edit / tell us about your place" submissions. Anyone
// (signed in or not) can flag a correction on a place or event, or ask for a
// brand-new place to be listed. Writes go through the service client so
// anonymous visitors can submit without an RLS insert policy; everything
// lands in the edit_suggestions review queue (see sql/086).

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { notifyEditSuggestion } from "@/lib/email";

export type SuggestResult = { ok?: true; error?: string };

const clip = (s: string | undefined | null, n: number) =>
  (s || "").trim().slice(0, n) || null;

export async function submitEditSuggestion(input: {
  targetType: "venue" | "event";
  targetId: string;
  targetName?: string;
  citySlug?: string;
  reason?: string;
  details?: string;
  contactName?: string;
  contactEmail?: string;
  isOwner?: boolean;
}): Promise<SuggestResult> {
  if (!input.targetId || (input.targetType !== "venue" && input.targetType !== "event")) {
    return { error: "Missing details." };
  }
  // Require at least a reason or some free text so we don't log empty rows.
  if (!clip(input.reason, 120) && !clip(input.details, 2000)) {
    return { error: "Tell us what's wrong or what should change." };
  }

  const sb = createServiceClient();
  const row = {
    target_type: input.targetType,
    target_id: input.targetId,
    target_name: clip(input.targetName, 200),
    city_slug: clip(input.citySlug, 80),
    reason: clip(input.reason, 120),
    details: clip(input.details, 2000),
    contact_name: clip(input.contactName, 120),
    contact_email: clip(input.contactEmail, 200),
    is_owner: !!input.isOwner,
  };

  const { error } = await sb.from("edit_suggestions").insert(row);
  if (error) return { error: error.message };

  // Keep the lightweight venue flag (counter + latest note) in sync so the
  // existing "⚠️ reports" admin badge still surfaces flagged places.
  if (input.targetType === "venue") {
    const { data } = await sb.from("venues").select("reports").eq("id", input.targetId).maybeSingle();
    await sb
      .from("venues")
      .update({
        reports: ((data?.reports as number) ?? 0) + 1,
        last_reported_at: new Date().toISOString(),
        report_note: (input.reason || input.details || "").slice(0, 200),
      })
      .eq("id", input.targetId);
  }

  notifyEditSuggestion(row).catch(() => {});
  revalidatePath("/admin");
  revalidatePath("/admin/suggestions");
  return { ok: true };
}

export async function submitPlaceLead(input: {
  placeName: string;
  details?: string;
  contactName?: string;
  contactEmail?: string;
}): Promise<SuggestResult> {
  const name = clip(input.placeName, 200);
  if (!name) return { error: "Tell us the name of your place." };

  const sb = createServiceClient();
  const row = {
    target_type: "new_place" as const,
    target_id: null,
    target_name: name,
    city_slug: null,
    reason: "New place request",
    details: clip(input.details, 2000),
    contact_name: clip(input.contactName, 120),
    contact_email: clip(input.contactEmail, 200),
    is_owner: true,
  };

  const { error } = await sb.from("edit_suggestions").insert(row);
  if (error) return { error: error.message };

  notifyEditSuggestion(row).catch(() => {});
  revalidatePath("/admin/suggestions");
  return { ok: true };
}
