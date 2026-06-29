import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EventCreateForm from "./EventCreateForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add an event — The Buzz Kids admin" };

export default async function AddEventPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/events/new");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin" && me?.role !== "editor") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Staff only</h1>
        <Link href="/dashboard" className="btn-secondary mt-6 inline-block">Back to dashboard</Link>
      </div>
    );
  }

  const [{ data: cities }, { data: venues }] = await Promise.all([
    supabase.from("cities").select("id, name, slug").order("name"),
    supabase.from("venues").select("id, name, city:cities(name)").eq("approved", true).order("name"),
  ]);

  return (
    <div className="container-page py-10 max-w-2xl">
      <Link href="/admin/events" className="text-sm text-buzz-mute hover:text-buzz-accent transition">← Back to events</Link>
      <p className="eyebrow mt-4 mb-1">What's On</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">Add an event</h1>
      <p className="text-buzz-mute mb-6 max-w-xl">
        A gala, fayre, holiday club or special day out. Attach it to one of your
        places, or leave that blank and just give it a location — handy for
        town-wide events that don't belong to a single venue.
      </p>
      <EventCreateForm cities={cities ?? []} venues={(venues ?? []) as any} />
    </div>
  );
}
