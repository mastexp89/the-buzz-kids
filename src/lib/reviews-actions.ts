"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Result = { ok?: true; error?: string };

// Parent leaves (or updates) a review for a place. We delete any existing
// review by this author for this venue and insert a fresh one, so the
// moderation guard (migration 067) always forces it back to 'pending' for
// re-checking — an edited review must be re-approved before it shows.
export async function submitReview(input: {
  venueId: string;
  rating: number;
  title: string;
  body: string;
  imageUrls: string[];
}): Promise<Result> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in to leave a review." };

  const rating = Math.max(1, Math.min(5, Math.round(input.rating)));
  if (!rating) return { error: "Pick a star rating." };

  await supabase.from("reviews").delete().eq("author_id", user.id).eq("venue_id", input.venueId);

  const { data: review, error } = await supabase
    .from("reviews")
    .insert({
      venue_id: input.venueId,
      author_id: user.id,
      rating,
      title: input.title.trim() || null,
      body: input.body.trim() || null,
    })
    .select("id, venue:venues(slug, city:cities(slug))")
    .single();
  if (error) return { error: error.message };

  const imgs = input.imageUrls.filter(Boolean).slice(0, 6);
  if (imgs.length > 0) {
    await supabase
      .from("review_images")
      .insert(imgs.map((url, i) => ({ review_id: (review as any).id, image_url: url, sort_order: i })));
  }

  const v: any = (review as any).venue;
  if (v?.city?.slug && v?.slug) revalidatePath(`/${v.city.slug}/venues/${v.slug}`);
  return { ok: true };
}

// Admin: approve / hide / un-hide a review.
export async function setReviewStatus(reviewId: string, status: "approved" | "hidden" | "pending"): Promise<Result> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (prof?.role !== "admin") return { error: "Admins only." };

  const { error } = await supabase.from("reviews").update({ status }).eq("id", reviewId);
  if (error) return { error: error.message };
  revalidatePath("/admin/reviews");
  return { ok: true };
}
