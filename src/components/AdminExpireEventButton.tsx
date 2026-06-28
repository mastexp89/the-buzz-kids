// Admin-only "Expire event now" button. Renders nothing for non-admins
// (server-side check). For admins, renders a small client widget that
// confirms then calls expireEventNow → sets event.end_time=now so the
// effectiveEndTime filter treats it as past and hides it from listings.

import { createClient } from "@/lib/supabase/server";
import ExpireEventClient from "./ExpireEventClient";

export default async function AdminExpireEventButton({
  eventId,
  eventTitle,
  hasEndTime,
}: {
  eventId: string;
  eventTitle: string;
  hasEndTime: boolean;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (prof?.role !== "admin") return null;

  return (
    <ExpireEventClient
      eventId={eventId}
      eventTitle={eventTitle}
      hasEndTime={hasEndTime}
    />
  );
}
