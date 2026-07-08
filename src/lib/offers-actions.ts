"use server";

// Public: a visitor flags an offer as "not on anymore". No auth — anyone can
// report. We just bump a counter + timestamp so admins can spot deals worth
// re-checking on the Offers admin page.
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

// Public: anyone can suggest a deal — no account. Lands as approved=false
// (pending) for an admin to review. Returns ok even if the admin email fails.
export async function submitOffer(input: {
  category: string;
  title: string;
  provider?: string;
  description?: string;
  terms?: string;
  url?: string;
  scope?: string;
  citySlug?: string;
  email?: string;
  newsletter?: boolean; // explicit opt-in to Buzz Kids emails
}): Promise<{ ok?: true; error?: string }> {
  const category = ["food", "days-out"].includes(input.category) ? input.category : null;
  if (!category) return { error: "Please pick a deal type." };
  const title = (input.title ?? "").trim();
  if (!title) return { error: "Please give the deal a short title." };

  const sb = createServiceClient();
  let cityId: string | null = null;
  const scope = input.scope === "local" ? "local" : "national";
  if (scope === "local" && input.citySlug) {
    const { data: c } = await sb.from("cities").select("id").eq("slug", input.citySlug).maybeSingle();
    cityId = c?.id ?? null;
  }

  const { error } = await sb.from("offers").insert({
    category,
    title,
    provider: (input.provider ?? "").trim() || null,
    description: (input.description ?? "").trim() || null,
    terms: (input.terms ?? "").trim() || null,
    url: (input.url ?? "").trim() || null,
    scope,
    city_id: cityId,
    approved: false,
    submitted_email: (input.email ?? "").trim() || null,
  });
  if (error) {
    if (error.code === "23505") return { error: "Looks like that deal is already on our list — thanks though!" };
    return { error: "Something went wrong. Please try again." };
  }

  // Consent-based mailing-list signup (same list the newsletter tool uses).
  const optInEmail = (input.email ?? "").trim().toLowerCase();
  if (input.newsletter && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(optInEmail)) {
    try {
      await sb.from("notify_signups").upsert({ email: optInEmail }, { onConflict: "email", ignoreDuplicates: true });
    } catch { /* best-effort */ }
  }

  // Best-effort admin notification. Falls back to hello@thebuzzkids.co.uk so it
  // still fires even if ADMIN_NOTIFY_EMAIL isn't set (matches the listings /
  // edit-suggestion path), and sets reply-to the suggester when they leave one.
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ADMIN_NOTIFY_EMAIL ?? "hello@thebuzzkids.co.uk";
  const from = process.env.ADMIN_NOTIFY_FROM ?? "The Buzz Kids <noreply@thebuzzkids.co.uk>";
  const replyTo = (input.email ?? "").trim() || null;
  if (key) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          from, to: [to],
          ...(replyTo ? { reply_to: replyTo } : {}),
          subject: `New deal suggestion: ${title}`,
          text: `Someone suggested a deal for The Buzz Kids:\n\n${title}\n${input.provider ?? ""}\n${input.description ?? ""}\n${input.url ?? ""}\n\nFrom: ${input.email || "no email given"}\n\nReview it: ${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/admin/offers`,
        }),
      });
    } catch { /* non-fatal */ }
  }

  return { ok: true };
}

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
