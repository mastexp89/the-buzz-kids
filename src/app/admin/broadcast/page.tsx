import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAudienceCounts } from "./actions";
import BroadcastClient from "./BroadcastClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Send a newsletter — The Buzz Kids admin" };

export default async function BroadcastPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/broadcast");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/admin" className="btn-secondary mt-6 inline-block">Back to admin</Link>
      </div>
    );
  }

  const counts = await getAudienceCounts();

  return (
    <div className="container-page py-10 max-w-2xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">← Back to admin</Link>
      <p className="eyebrow mt-4 mb-1">Email</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">Send a newsletter</h1>
      <p className="text-buzz-mute mb-6 max-w-xl">
        Email your waitlist and/or parent accounts. Every send includes an unsubscribe link, and
        anyone who's unsubscribed is skipped automatically. Always send a test to yourself first.
      </p>
      <BroadcastClient counts={counts} />
    </div>
  );
}
