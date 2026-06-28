import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyNotificationPrefs } from "./actions";
import NotificationPrefsClient from "./NotificationPrefsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications — The Buzz Guide" };

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/notifications");

  const prefs = await getMyNotificationPrefs();

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div>
        <p className="eyebrow mb-1">My account</p>
        <h1 className="h-display text-4xl">Notifications</h1>
        <p className="text-buzz-mute mt-2 text-sm">
          Pick which emails you want from The Buzz Guide. We&apos;ll only message you about
          things you&apos;ve favourited — never general marketing.
        </p>
      </div>

      <NotificationPrefsClient initial={prefs} email={user.email ?? ""} />
    </div>
  );
}
