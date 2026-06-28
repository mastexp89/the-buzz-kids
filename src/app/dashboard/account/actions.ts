"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function updateProfile(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const display_name = String(formData.get("display_name") ?? "").trim() || null;
  const avatar_url = String(formData.get("avatar_url") ?? "").trim() || null;

  const { error } = await supabase
    .from("profiles")
    .update({ display_name, avatar_url })
    .eq("id", user.id);

  if (error) return { error: error.message };
  revalidatePath("/dashboard/account");
  return { ok: true };
}

export async function updateEmail(formData: FormData) {
  const supabase = await createClient();
  const newEmail = String(formData.get("email") ?? "").trim();
  if (!newEmail || !newEmail.includes("@")) return { error: "Please enter a valid email." };

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thebuzzguide.co.uk";

  const { error } = await supabase.auth.updateUser(
    { email: newEmail },
    { emailRedirectTo: `${siteUrl}/auth/callback` }
  );
  if (error) return { error: error.message };

  return { ok: true, info: `Confirmation email sent to ${newEmail}. Click the link there to finish the change.` };
}

export async function updatePassword(formData: FormData) {
  const supabase = await createClient();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password !== confirm) return { error: "Passwords don't match." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  return { ok: true, info: "Password updated." };
}

// Self-service account deletion. Required by Apple's App Store guideline
// 5.1.1(v) — apps that allow account creation must allow account deletion
// from within the app itself.
//
// What gets removed:
//   - Auth user (via Supabase admin API)
//   - profiles row (cascades to venues, artists, events the user owns)
//   - The session itself, by signing them out
//
// What gets kept (covered in /delete-account public page):
//   - Stripe transaction records (legal retention)
//   - Past events at venues now deleted (anonymised to "Removed venue")
//   - Server logs (Vercel, 30 days)
export async function deleteMyAccount(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Confirmation phrase guard — user must type DELETE to confirm. Prevents
  // accidental clicks from nuking their account.
  const phrase = String(formData.get("confirm_phrase") ?? "").trim();
  if (phrase.toUpperCase() !== "DELETE") {
    return { error: 'Type DELETE in the box to confirm.' };
  }

  const sb = createServiceClient();

  // 1. Anonymise events the user submitted but doesn't own a venue for —
  //    keeps the historical event listing intact but disconnects it from
  //    the user.
  await sb.from("events").update({ submitted_by: null }).eq("submitted_by", user.id);

  // 2. Delete venues this user owns. Cascade kills events / event_artists /
  //    event_genres / festival_venues / venue_claims / promotions etc.
  await sb.from("venues").delete().eq("owner_id", user.id);

  // 3. Unclaim any artists they claimed. Keep the artist row (might be
  //    referenced by other events) but null out the claim.
  await sb.from("artists").update({ claimed_by: null }).eq("claimed_by", user.id);

  // 4. Delete their messages history (both directions)
  await sb.from("messages").delete().eq("user_id", user.id);

  // 5. Delete the profile row. Some FKs cascade from this; others were handled above.
  await sb.from("profiles").delete().eq("id", user.id);

  // 6. Finally, delete the auth user. This is the irreversible bit.
  const { error: authErr } = await sb.auth.admin.deleteUser(user.id);
  if (authErr) {
    return { error: `Account data removed but auth deletion failed: ${authErr.message}. Email admin@thebuzzguide.co.uk to finish the process.` };
  }

  // Sign out the local session and redirect home
  await supabase.auth.signOut();
  // Belt-and-braces: clear session cookies if any remain
  const cookieStore = await cookies();
  for (const c of cookieStore.getAll()) {
    if (c.name.startsWith("sb-") || c.name.includes("supabase")) {
      cookieStore.delete(c.name);
    }
  }
  revalidatePath("/", "layout");
  redirect("/account-deleted");
}
