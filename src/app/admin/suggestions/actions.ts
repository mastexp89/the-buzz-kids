"use server";

// Admin actions for the edit_suggestions review queue.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { parseSuggestion, type ParsedSuggestion } from "@/lib/extraction";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return prof?.role === "admin" ? user : null;
}

export async function setSuggestionStatus(
  id: string,
  status: "new" | "done",
): Promise<{ ok?: true; error?: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();
  const { error } = await sb.from("edit_suggestions").update({ status }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/suggestions");
  revalidatePath("/admin");
  return { ok: true };
}

export async function deleteSuggestion(id: string): Promise<{ ok?: true; error?: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();
  const { error } = await sb.from("edit_suggestions").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/suggestions");
  revalidatePath("/admin");
  return { ok: true };
}

// ---------------------------------------------------------------
// Turn a submission into an approvable draft.
//
// Submissions arrive as a name plus free text ("Lodge Ancient 49 7 Artillery
// Lane Dundee 10 - 4") and had to be retyped by hand into an event or place.
// Parse it into fields the admin can check, correct and approve in one go.
// Nothing is written until they press create — this only reads.
// ---------------------------------------------------------------

export type DraftResult =
  | { ok: true; draft: ParsedSuggestion; areas: { id: string; name: string; slug: string }[] }
  | { error: string };

export async function draftFromSuggestion(id: string): Promise<DraftResult> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();
  const { data: sug } = await sb
    .from("edit_suggestions")
    .select("target_name, details, reason")
    .eq("id", id)
    .maybeSingle();
  if (!sug) return { error: "Suggestion not found." };

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  let draft: ParsedSuggestion | null = null;
  try {
    draft = await parseSuggestion({
      name: sug.target_name ?? "",
      details: sug.details ?? "",
      reason: sug.reason,
      today,
    });
  } catch (e: any) {
    return { error: e?.message ?? "Could not read that submission." };
  }
  if (!draft) return { error: "Couldn't make sense of that submission — add it manually." };

  const { data: cities } = await sb
    .from("cities").select("id, name, slug").eq("active", true).order("name");
  return { ok: true, draft, areas: (cities ?? []) as any };
}

export type CreatePayload = {
  suggestionId: string;
  kind: "event" | "place";
  title: string;
  description?: string | null;
  cityId: string;
  locationName?: string | null;   // venue/address text when there's no venue record
  address?: string | null;
  date?: string | null;           // YYYY-MM-DD (events)
  startTime?: string | null;      // HH:MM
  endTime?: string | null;
  isFree?: boolean;
  price?: string | null;
};

export async function createFromSuggestion(
  p: CreatePayload,
): Promise<{ ok?: true; id?: string; error?: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  if (!p.title?.trim()) return { error: "Give it a title." };
  if (!p.cityId) return { error: "Pick an area." };
  const sb = createServiceClient();

  if (p.kind === "place") {
    const slugBase = p.title.toLowerCase().normalize("NFKD")
      .replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "place";
    let slug = slugBase;
    for (let n = 2; n < 40; n++) {
      const { data: clash } = await sb.from("venues").select("id").eq("slug", slug).maybeSingle();
      if (!clash) break;
      slug = `${slugBase}-${n}`;
    }
    const { data, error } = await sb
      .from("venues")
      .insert({
        name: p.title.trim(),
        slug,
        description: p.description ?? null,
        address: p.address ?? null,
        city_id: p.cityId,
        // Created unapproved: it still wants a photo and a check before it's public.
        approved: false,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };
    await sb.from("edit_suggestions").update({ status: "done" }).eq("id", p.suggestionId);
    revalidatePath("/admin/suggestions");
    return { ok: true, id: data.id };
  }

  // Event: a date is required, everything else is optional.
  if (!p.date) return { error: "An event needs a date — add one, or create it as a place." };
  const start = `${p.date}T${p.startTime ?? "10:00"}:00`;
  const end = p.endTime ? `${p.date}T${p.endTime}:00` : null;
  const { data, error } = await sb
    .from("events")
    .insert({
      city_id: p.cityId,
      location_name: p.locationName ?? null,
      title: p.title.trim(),
      description: p.description ?? null,
      start_time: new Date(start).toISOString(),
      end_time: end ? new Date(end).toISOString() : null,
      is_free: !!p.isFree,
      cover_charge: p.isFree ? null : (p.price ?? null),
      status: "approved",
      cancelled: false,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  await sb.from("edit_suggestions").update({ status: "done" }).eq("id", p.suggestionId);
  revalidatePath("/admin/suggestions");
  return { ok: true, id: data.id };
}
