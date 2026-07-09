"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") throw new Error("Admins only.");
  return createServiceClient();
}

export async function updateWheelConfig(formData: FormData): Promise<void> {
  const sb = await requireAdmin();
  const closes = String(formData.get("closes_on") ?? "").trim();
  await sb.from("wheel_config").update({
    grand_prize: String(formData.get("grand_prize") ?? "").trim() || "a family day out",
    grand_detail: String(formData.get("grand_detail") ?? "").trim() || null,
    closes_on: closes || null,
    active: formData.get("active") === "on",
    updated_at: new Date().toISOString(),
  }).eq("id", 1);
  revalidatePath("/admin/wheel");
  revalidatePath("/win");
}

export async function upsertPrize(formData: FormData): Promise<void> {
  const sb = await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  const row = {
    label: String(formData.get("label") ?? "").trim(),
    kind: String(formData.get("kind") ?? "entry") === "real" ? "real" : "entry",
    slots: Math.max(1, parseInt(String(formData.get("slots") ?? "1"), 10) || 1),
    color: String(formData.get("color") ?? "#9B4DFF").trim() || "#9B4DFF",
    sort: parseInt(String(formData.get("sort") ?? "0"), 10) || 0,
    active: formData.get("active") === "on",
  };
  if (!row.label) return;
  if (id) await sb.from("wheel_prizes").update(row).eq("id", id);
  else await sb.from("wheel_prizes").insert(row);
  revalidatePath("/admin/wheel");
  revalidatePath("/win");
}

export async function deletePrize(formData: FormData): Promise<void> {
  const sb = await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (id) await sb.from("wheel_prizes").delete().eq("id", id);
  revalidatePath("/admin/wheel");
  revalidatePath("/win");
}

export async function setSpinFulfilled(formData: FormData): Promise<void> {
  const sb = await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  const value = formData.get("fulfilled") === "true";
  if (id) await sb.from("wheel_spins").update({ fulfilled: value }).eq("id", id);
  revalidatePath("/admin/wheel");
}

export type DrawResult = { ok: boolean; winner?: string; entrants?: number; entries?: number; message?: string };

// Pick a random confirmed winner for a draw (a given entry-prize label).
// Weighted naturally: each spin row is one chance, so a person who spun more
// days has more chances.
export async function drawWinner(label: string): Promise<DrawResult> {
  const sb = await requireAdmin();
  const { data: spins } = await sb
    .from("wheel_spins").select("email").eq("prize_label", label).eq("prize_kind", "entry");
  if (!spins || spins.length === 0) return { ok: false, message: "No entries yet for this prize." };

  const { data: confirmed } = await sb.from("notify_signups").select("email").eq("confirmed", true);
  const okEmails = new Set((confirmed ?? []).map((c) => c.email));

  const eligible = spins.filter((s) => okEmails.has(s.email));
  if (eligible.length === 0) return { ok: false, message: "No confirmed entries yet — nobody's confirmed their email." };

  const winner = eligible[Math.floor(Math.random() * eligible.length)].email;
  const entrants = new Set(eligible.map((s) => s.email)).size;
  return { ok: true, winner, entrants, entries: eligible.length };
}
