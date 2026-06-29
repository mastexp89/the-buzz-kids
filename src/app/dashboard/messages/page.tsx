import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listMyMessages, markMyMessagesRead } from "@/lib/messages-actions";
import UserThreadClient from "./UserThreadClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Messages — The Buzz Kids" };

export default async function DashboardMessagesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const messages = await listMyMessages();
  // Mark admin-sent messages as read on view
  await markMyMessagesRead().catch(() => {});

  return (
    <div className="max-w-3xl">
      <p className="eyebrow mb-1">Your messages</p>
      <h1 className="h-display text-4xl mb-2">📬 Talk to The Buzz Kids</h1>
      <p className="text-buzz-mute mb-6 max-w-xl">
        Need help, want to claim something, or got feedback? Drop us a message — we usually reply within a day.
      </p>
      <UserThreadClient initialMessages={messages} />
    </div>
  );
}
