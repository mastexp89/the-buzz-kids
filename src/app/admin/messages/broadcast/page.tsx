import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BroadcastForm from "./BroadcastForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Broadcast — The Buzz Kids admin" };

export default async function BroadcastPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Not authorised</h1>
        <Link href="/admin" className="btn-secondary mt-6 inline-block">Back to admin</Link>
      </div>
    );
  }

  // Counts per role for the picker — includes fans (role='user') so the
  // dropdown can show "Fans only (123)" too.
  const counts: Record<string, number> = {};
  for (const role of ["user", "venue_owner", "artist", "event_organiser"]) {
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", role);
    counts[role] = count ?? 0;
  }
  const total = (counts.user ?? 0) + (counts.venue_owner ?? 0) + (counts.artist ?? 0) + (counts.event_organiser ?? 0);

  return (
    <div className="container-page py-10 max-w-2xl">
      <Link href="/admin/messages" className="text-sm text-buzz-mute hover:text-buzz-accent transition">← Back to messages</Link>
      <p className="eyebrow mt-3 mb-1">Admin · Broadcast</p>
      <h1 className="h-display text-4xl mb-2">📢 Send to everyone</h1>
      <p className="text-buzz-mute mb-6 max-w-xl">
        Drops a single message into every chosen user's inbox. They'll see it in their dashboard and (optionally) get an email ping.
      </p>

      <BroadcastForm
        counts={{
          all: total,
          venue_owner: counts.venue_owner ?? 0,
          artist: counts.artist ?? 0,
          event_organiser: counts.event_organiser ?? 0,
        }}
      />
    </div>
  );
}
