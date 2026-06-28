// Shared cleanup used by both the self-service delete (/api/account/delete)
// and the admin delete (/admin/users/[id] deleteUserProfile action).
//
// Some foreign keys to auth.users(id) don't cascade or set null, which makes
// `auth.admin.deleteUser` fail with "Database error deleting user". Instead
// of relying on the DB, we explicitly clear / detach every row this app
// creates for a user before calling the auth delete.
//
// This function does NOT delete venues — both call sites handle that
// separately (admin refuses to delete users who still own venues; the
// self-service path deletes the user's owned venues + their child rows).

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Clean up everything the app stores about `userId` so that `auth.admin
 * .deleteUser(userId)` will succeed afterwards.
 *
 * Pass a service-role client (createServiceClient) so RLS doesn't block
 * the cross-table writes.
 */
export async function cleanupUserDataBeforeAuthDelete(
  admin: SupabaseClient,
  userId: string,
) {
  // Detach the user from any artist page they claimed rather than deleting
  // the row — historical gigs link to it and the page becomes claimable
  // again for someone else.
  await admin
    .from("artists")
    .update({ claimed_by: null })
    .eq("claimed_by", userId);

  // Suggestions they made about new venues. Safe to delete — pre-approval
  // proposals only.
  await admin.from("venue_suggestions").delete().eq("submitted_by", userId);

  // Pending claims they submitted. Safe to delete; artist_claims and
  // venue_claims both have ON DELETE CASCADE on claimant_user_id, so this
  // is technically redundant — but explicit is fine.
  await admin.from("artist_claims").delete().eq("claimant_user_id", userId);
  await admin.from("venue_claims").delete().eq("claimant_user_id", userId);

  // Detach any gigs the user submitted to venues they don't own — those are
  // useful historical content. Set submitted_by to NULL so the auth.users
  // row can be removed cleanly.
  await admin
    .from("events")
    .update({ submitted_by: null })
    .eq("submitted_by", userId);

  // Messages the user has in their thread. CASCADE on user_id means the
  // auth delete will take these out anyway, but doing it first means the
  // delete works even if that FK ever changes.
  await admin.from("messages").delete().eq("user_id", userId);

  // Finally, delete the profiles row. profiles.id references auth.users
  // and is the most common blocker because it's created automatically by
  // a trigger on signup, so every single user has one.
  await admin.from("profiles").delete().eq("id", userId);
}
