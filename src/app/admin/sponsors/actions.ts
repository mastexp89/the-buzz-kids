"use server";

// Admin server actions for managing third-party sponsors (takeaways, taxis,
// hairdressers etc paying for ad slots). See sql/029_sponsors.sql for the
// data model + tier semantics.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return null;
  return { userId: user.id };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export type SponsorTier = "starter" | "popular" | "premium";
export type SponsorStatus = "active" | "paused" | "expired";

export type SponsorRow = {
  id: string;
  name: string;
  slug: string;
  tier: SponsorTier;
  city_id: string | null;
  city_name: string | null;
  city_slug: string | null;
  category: string | null;
  image_url: string | null;
  link_url: string;
  blurb: string | null;
  status: SponsorStatus;
  starts_at: string;
  ends_at: string;
  monthly_price: number | null;
  impression_count: number;
  click_count: number;
  show_on_app: boolean;
  created_at: string;
};

export async function listSponsors(): Promise<SponsorRow[]> {
  if (!(await requireAdmin())) return [];
  const sb = createServiceClient();
  const { data } = await sb
    .from("sponsors")
    .select("*, city:cities(id, name, slug)")
    .order("status", { ascending: true })
    .order("ends_at", { ascending: true });
  return (data ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    tier: r.tier,
    city_id: r.city_id,
    city_name: r.city?.name ?? null,
    city_slug: r.city?.slug ?? null,
    category: r.category,
    image_url: r.image_url,
    link_url: r.link_url,
    blurb: r.blurb,
    status: r.status,
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    monthly_price: r.monthly_price,
    impression_count: r.impression_count ?? 0,
    click_count: r.click_count ?? 0,
    show_on_app: r.show_on_app ?? true,
    created_at: r.created_at,
  }));
}

export type CreateSponsorInput = {
  name: string;
  tier: SponsorTier;
  link_url: string;
  blurb?: string;
  image_url?: string;
  city_id?: string | null;
  category?: string | null;
  monthly_price?: number | null;
  // ISO date strings (YYYY-MM-DD). Defaults: today → today+30d.
  starts_at?: string;
  ends_at?: string;
};

export async function createSponsor(
  input: CreateSponsorInput,
): Promise<{ ok: true; id: string; slug: string } | { error: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const name = input.name.trim();
  if (!name) return { error: "Name is required." };
  if (!input.link_url?.trim()) return { error: "Link URL is required." };
  if (!input.tier) return { error: "Tier is required." };

  const sb = createServiceClient();

  // Unique slug.
  let slug = slugify(name) || "sponsor";
  for (let i = 0; i < 5; i++) {
    const { data: existing } = await sb.from("sponsors").select("id").eq("slug", slug).maybeSingle();
    if (!existing) break;
    slug = `${slugify(name)}-${i + 2}`;
  }

  const now = new Date();
  const startsAt = input.starts_at ? new Date(input.starts_at) : now;
  const defaultEnd = new Date(startsAt);
  defaultEnd.setDate(defaultEnd.getDate() + 30);
  const endsAt = input.ends_at ? new Date(input.ends_at) : defaultEnd;

  if (endsAt <= startsAt) return { error: "End date must be after start date." };

  const { data: created, error } = await sb
    .from("sponsors")
    .insert({
      name,
      slug,
      tier: input.tier,
      city_id: input.city_id ?? null,
      category: input.category ?? null,
      image_url: input.image_url?.trim() || null,
      link_url: input.link_url.trim(),
      blurb: input.blurb?.trim() || null,
      status: "active",
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      monthly_price: input.monthly_price ?? null,
    })
    .select("id, slug")
    .single();
  if (error || !created) return { error: error?.message ?? "Insert failed" };

  revalidatePath("/admin/sponsors");
  revalidatePath("/");
  revalidatePath("/sponsors");
  return { ok: true, id: created.id, slug: created.slug };
}

export type UpdateSponsorInput = Partial<CreateSponsorInput> & {
  status?: SponsorStatus;
  show_on_app?: boolean;
};

export async function updateSponsor(
  id: string,
  patch: UpdateSponsorInput,
): Promise<{ ok: true } | { error: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();

  const cleaned: Record<string, any> = {};
  if (patch.name !== undefined) cleaned.name = patch.name.trim();
  if (patch.tier !== undefined) cleaned.tier = patch.tier;
  if (patch.city_id !== undefined) cleaned.city_id = patch.city_id ?? null;
  if (patch.category !== undefined) cleaned.category = patch.category ?? null;
  if (patch.image_url !== undefined) cleaned.image_url = patch.image_url?.trim() || null;
  if (patch.link_url !== undefined) cleaned.link_url = patch.link_url.trim();
  if (patch.blurb !== undefined) cleaned.blurb = patch.blurb?.trim() || null;
  if (patch.status !== undefined) cleaned.status = patch.status;
  if (patch.starts_at !== undefined) cleaned.starts_at = new Date(patch.starts_at).toISOString();
  if (patch.ends_at !== undefined) cleaned.ends_at = new Date(patch.ends_at).toISOString();
  if (patch.monthly_price !== undefined) cleaned.monthly_price = patch.monthly_price ?? null;
  if (patch.show_on_app !== undefined) cleaned.show_on_app = !!patch.show_on_app;

  if (Object.keys(cleaned).length === 0) return { ok: true };

  const { data: row } = await sb.from("sponsors").select("slug").eq("id", id).maybeSingle();
  const { error } = await sb.from("sponsors").update(cleaned).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/sponsors");
  revalidatePath("/");
  revalidatePath("/sponsors");
  if (row?.slug) revalidatePath(`/sponsors/${row.slug}`);
  return { ok: true };
}

// Quick status flips — same as updateSponsor with one field, but a friendlier
// API for the row action buttons.
export async function pauseSponsor(id: string) {
  return updateSponsor(id, { status: "paused" });
}
export async function resumeSponsor(id: string) {
  return updateSponsor(id, { status: "active" });
}
export async function expireSponsor(id: string) {
  return updateSponsor(id, { status: "expired" });
}

// Extend an existing sponsor by N more days from their current ends_at.
// Use case: customer paid for another month, click "Extend 30d" instead of
// re-typing dates.
export async function extendSponsor(
  id: string,
  days: number,
): Promise<{ ok: true; newEndsAt: string } | { error: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  if (!Number.isFinite(days) || days <= 0 || days > 365) {
    return { error: "Days must be 1–365." };
  }
  const sb = createServiceClient();
  const { data: row } = await sb
    .from("sponsors")
    .select("ends_at, status")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { error: "Sponsor not found." };

  // Extend from whichever is later: now or current ends_at. So renewing an
  // expired ad gives them a full new period starting today.
  const base = new Date(row.ends_at).getTime();
  const now = Date.now();
  const start = base > now ? base : now;
  const newEnd = new Date(start + days * 24 * 60 * 60 * 1000);

  const { error } = await sb
    .from("sponsors")
    .update({
      ends_at: newEnd.toISOString(),
      status: "active", // auto-reactivate if they'd lapsed
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/sponsors");
  revalidatePath("/");
  return { ok: true, newEndsAt: newEnd.toISOString() };
}

export async function deleteSponsor(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();
  const { error } = await sb.from("sponsors").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/sponsors");
  revalidatePath("/");
  revalidatePath("/sponsors");
  return { ok: true };
}

// Cities list for the admin form's "Target city" dropdown.
export async function listCitiesForForm(): Promise<{ id: string; name: string; slug: string }[]> {
  if (!(await requireAdmin())) return [];
  const sb = createServiceClient();
  const { data } = await sb
    .from("cities")
    .select("id, name, slug")
    .order("name");
  return (data ?? []) as any;
}
