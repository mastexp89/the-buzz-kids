"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return prof?.role === "admin" ? user : null;
}

// Editors (restricted contributors) can ADD offers (auto-approved) but not
// approve/delete other people's — those stay super-admin only.
async function requireContributor() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return prof?.role === "admin" || prof?.role === "editor" ? user : null;
}

export type OfferResult = { ok?: true; error?: string };

export async function createOffer(formData: FormData): Promise<OfferResult> {
  if (!(await requireContributor())) return { error: "Staff only." };

  const category = String(formData.get("category") ?? "");
  if (!["food", "days-out"].includes(category)) return { error: "Pick a category." };
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Give the offer a title." };

  const scope = String(formData.get("scope") ?? "national") === "local" ? "local" : "national";
  const cityId = String(formData.get("city_id") ?? "").trim() || null;

  const sb = createServiceClient();
  const { error } = await sb.from("offers").insert({
    category,
    title,
    provider: String(formData.get("provider") ?? "").trim() || null,
    description: String(formData.get("description") ?? "").trim() || null,
    terms: String(formData.get("terms") ?? "").trim() || null,
    url: String(formData.get("url") ?? "").trim() || null,
    business_url: String(formData.get("business_url") ?? "").trim() || null,
    scope,
    city_id: scope === "local" ? cityId : null,
    venue_id: String(formData.get("venue_id") ?? "").trim() || null,
    image_url: String(formData.get("image_url") ?? "").trim() || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/offers");
  revalidatePath("/browse");
  return { ok: true };
}

export async function updateOffer(id: string, formData: FormData): Promise<OfferResult> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  if (!id) return { error: "Missing offer." };

  const category = String(formData.get("category") ?? "");
  if (!["food", "days-out"].includes(category)) return { error: "Pick a category." };
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Give the offer a title." };

  const scope = String(formData.get("scope") ?? "national") === "local" ? "local" : "national";
  const cityId = String(formData.get("city_id") ?? "").trim() || null;

  const sb = createServiceClient();
  const { error } = await sb
    .from("offers")
    .update({
      category,
      title,
      provider: String(formData.get("provider") ?? "").trim() || null,
      description: String(formData.get("description") ?? "").trim() || null,
      terms: String(formData.get("terms") ?? "").trim() || null,
      url: String(formData.get("url") ?? "").trim() || null,
      business_url: String(formData.get("business_url") ?? "").trim() || null,
      scope,
      city_id: scope === "local" ? cityId : null,
      venue_id: String(formData.get("venue_id") ?? "").trim() || null,
      image_url: String(formData.get("image_url") ?? "").trim() || null,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/offers");
  revalidatePath("/browse");
  return { ok: true };
}

// Search live places to attach an offer to.
export async function searchOfferVenues(query: string) {
  if (!(await requireContributor())) return { results: [] as any[] };
  const q = query.trim();
  if (q.length < 2) return { results: [] as any[] };
  const sb = createServiceClient();
  const { data } = await sb
    .from("venues")
    .select("id, name, city:cities(name)")
    .ilike("name", `%${q}%`)
    .eq("approved", true)
    .order("name")
    .limit(8);
  return { results: data ?? [] };
}

// Upload a deal poster and read the details off it with AI, so the admin can
// just drop an image and have the form fill itself.
export async function extractOfferFromImage(dataUrl: string, filename: string) {
  if (!(await requireContributor())) return { error: "Staff only." };
  const A = process.env.ANTHROPIC_API_KEY;
  if (!A) return { error: "AI isn't configured." };
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl || "");
  if (!m) return { error: "Not an image." };
  const mediaType = m[1];
  const b64 = m[2];

  // Store the poster (best-effort) so it can be the offer image.
  let imageUrl: string | null = null;
  try {
    const sb = createServiceClient();
    const ext = (mediaType.split("/")[1] || "jpg").replace("jpeg", "jpg");
    const path = `offers/${filename.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}-${Date.now().toString(36)}.${ext}`;
    const { error } = await sb.storage.from("media").upload(path, Buffer.from(b64, "base64"), { contentType: mediaType, upsert: true });
    if (!error) imageUrl = sb.storage.from("media").getPublicUrl(path).data.publicUrl;
  } catch { /* image is optional */ }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": A, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
            { type: "text", text:
              "This is a poster for a family deal/offer in the UK. Extract it as JSON only (no prose):\n" +
              "{ \"category\": \"food\" | \"days-out\", \"title\": string, \"provider\": string, " +
              "\"description\": string (one line), \"terms\": string (ages/days/spend/branches), " +
              "\"scope\": \"national\" | \"local\", \"url\": string }.\n" +
              "category: 'food' for eating-out deals (kids eat free etc.), 'days-out' for attractions/activities. " +
              "scope: 'national' if a UK-wide chain, else 'local'. Use empty strings for anything not shown." },
          ],
        }],
      }),
    });
    const j = await res.json();
    if (j.error) return { error: j.error.message, imageUrl };
    const text = (j.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
    const fields = JSON.parse(text);
    return { imageUrl, fields };
  } catch (e: any) {
    return { error: `Couldn't read the poster: ${e.message}`, imageUrl };
  }
}

export async function approveOffer(id: string): Promise<OfferResult> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();
  const { error } = await sb.from("offers").update({ approved: true }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/offers");
  revalidatePath("/browse");
  return { ok: true };
}

export async function deleteOffer(id: string): Promise<OfferResult> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();
  const { error } = await sb.from("offers").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/offers");
  revalidatePath("/browse");
  return { ok: true };
}
