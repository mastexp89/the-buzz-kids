import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EventsManageClient from "./EventsManageClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manage events — The Buzz Kids admin" };

export default async function EventsManagePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/events-manage");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/admin" className="btn-secondary mt-6 inline-block">Back to admin</Link>
      </div>
    );
  }

  const [{ data: events }, { data: cities }] = await Promise.all([
    supabase
      .from("events")
      .select(`
        id, title, description, start_time, end_time, image_url, is_free, cover_charge,
        status, cancelled, location_name,
        venue:venues(id, name, slug, image_url, cover_photo_url, logo_url, google_photo_url, city:cities(name, slug)),
        city:cities(name, slug),
        event_genres ( genre:genres ( name, slug ) )
      `)
      .order("start_time", { ascending: true }),
    supabase.from("cities").select("name, slug, active").order("name"),
  ]);

  const rows = (events ?? []).map((e: any) => ({
    ...e,
    categories: (e.event_genres ?? []).map((eg: any) => eg.genre).filter(Boolean),
  }));

  return (
    <div className="container-page py-10 max-w-6xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">← Back to admin</Link>
      <div className="flex items-center justify-between gap-3 flex-wrap mt-4 mb-2">
        <div>
          <p className="eyebrow mb-1">What's On</p>
          <h1 className="h-display text-4xl sm:text-5xl">Manage events</h1>
        </div>
        <Link href="/admin/events/new" className="btn-primary shrink-0">+ Add event</Link>
      </div>
      <p className="text-buzz-mute mb-6 max-w-xl">
        Every dated event — galas, fayres, shows and special days. Edit or delete any of them,
        filter by area, or search by title.
      </p>
      <EventsManageClient events={rows} cities={cities ?? []} />
    </div>
  );
}
