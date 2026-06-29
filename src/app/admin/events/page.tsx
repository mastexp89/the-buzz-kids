import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EventsAdminClient from "./EventsAdminClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Events search — The Buzz Kids admin" };

export default async function EventsAdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/dashboard" className="btn-secondary mt-6 inline-block">Back to dashboard</Link>
      </div>
    );
  }

  return (
    <div className="container-page py-10 max-w-6xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">🔎 Events search</h1>
      <p className="text-buzz-mute mb-8 max-w-2xl">
        Find any event in the system by title, venue, day or status. Click <strong>Edit</strong>
        on a row to jump straight to the event's edit page where you can change every field
        (title, time, description, image, genres, artists, even reassign it to a different venue).
      </p>
      <EventsAdminClient />
    </div>
  );
}
