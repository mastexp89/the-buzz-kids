"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type NotificationPrefs = {
  new_gig_at_favourite_venue: boolean;
  new_gig_with_favourite_artist: boolean;
  new_gig_from_favourite_organiser: boolean;
  morning_of_reminder: boolean;
  fifteen_minute_reminder: boolean;
};

const DEFAULTS: NotificationPrefs = {
  new_gig_at_favourite_venue: true,
  new_gig_with_favourite_artist: true,
  new_gig_from_favourite_organiser: true,
  morning_of_reminder: true,
  fifteen_minute_reminder: true,
};

export async function getMyNotificationPrefs(): Promise<NotificationPrefs> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return DEFAULTS;
  const { data: profile } = await supabase
    .from("profiles")
    .select("notification_prefs")
    .eq("id", user.id)
    .maybeSingle();
  const stored = (profile?.notification_prefs ?? {}) as Partial<NotificationPrefs>;
  return { ...DEFAULTS, ...stored };
}

export async function updateNotificationPrefs(
  patch: Partial<NotificationPrefs>,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Merge with existing so we don't accidentally null out unrelated keys
  const current = await getMyNotificationPrefs();
  const next = { ...current, ...patch };

  const { error } = await supabase
    .from("profiles")
    .update({ notification_prefs: next })
    .eq("id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/notifications");
  return { ok: true };
}
