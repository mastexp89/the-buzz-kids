import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function DeprecatedEditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { id } = await params;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: event } = await supabase
    .from("events")
    .select("id, venue:venues!inner(id, owner_id)")
    .eq("id", id)
    .single();
  if (!event) notFound();
  // Owner OR admin can pass through; others get 404
  const isOwner = (event.venue as any).owner_id === user.id;
  if (!isOwner) {
    const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (me?.role !== "admin") notFound();
  }
  redirect(`/dashboard/venues/${(event.venue as any).id}/events/${id}/edit`);
}
