import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listConversations } from "@/lib/messages-actions";
import ComposeBox from "./ComposeBox";

export const dynamic = "force-dynamic";
export const metadata = { title: "Messages — The Buzz Guide admin" };

export default async function AdminMessagesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("profiles").select("role, email").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin" || me?.email?.toLowerCase() !== "dylanwilliamson@gmail.com") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Messaging is private</h1>
        <p className="text-buzz-mute mb-6">This admin tool is restricted to one account.</p>
        <Link href="/admin" className="btn-secondary">Back to admin</Link>
      </div>
    );
  }

  const conversations = await listConversations();

  return (
    <div className="container-page py-10 max-w-4xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">← Back to admin</Link>
      <p className="eyebrow mt-3 mb-1">Admin · Messages</p>
      <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
        <h1 className="h-display text-4xl sm:text-5xl">📬 Conversations</h1>
        <div className="flex gap-2 items-center">
          <ComposeBox />
          <Link href="/admin/messages/broadcast" className="btn-primary">📢 Broadcast</Link>
        </div>
      </div>

      {conversations.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-4xl mb-3">📭</div>
          <h2 className="h-display text-2xl mb-2">No conversations yet</h2>
          <p className="text-buzz-mute">Start one by visiting any user's admin page.</p>
        </div>
      ) : (
        <ul className="card divide-y divide-buzz-border/60">
          {conversations.map((c) => (
            <li key={c.user_id}>
              <Link
                href={`/admin/messages/${c.user_id}`}
                className="flex items-start gap-3 p-4 hover:bg-buzz-surface transition"
              >
                <div className="w-10 h-10 rounded-full bg-buzz-surface border border-buzz-border grid place-items-center text-lg shrink-0">
                  {c.role === "artist" ? "🎤" : c.role === "venue_owner" ? "🐝" : "👤"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="font-medium truncate">
                      {c.display_name ?? c.email ?? "—"}
                      {c.unread_from_user > 0 && (
                        <span className="ml-2 inline-flex items-center justify-center text-[11px] font-bold bg-buzz-accent text-black rounded-full px-2 py-0.5">
                          {c.unread_from_user}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-buzz-mute shrink-0">
                      {new Date(c.last_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  <div className="text-sm text-buzz-mute truncate mt-0.5">
                    {c.last_from_admin && <span className="text-buzz-accent">You: </span>}
                    {c.last_body}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
