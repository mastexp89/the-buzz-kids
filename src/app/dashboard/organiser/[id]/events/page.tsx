import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listOrganiserEvents } from "./actions";
import OrganiserEventsClient from "./OrganiserEventsClient";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export const metadata = { title: "Manage events — The Buzz Kids" };

export default async function OrganiserEventsPage({ params }: Props) {
  const supabase = await createClient();
  const { id } = await params;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/dashboard/organiser/${id}/events`);

  const { data: organiser } = await supabase
    .from("organisers")
    .select("id, name, slug, claimed_by")
    .eq("id", id)
    .maybeSingle();
  if (!organiser) notFound();

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  const isAdmin = profile?.role === "admin";
  if (!isAdmin && organiser.claimed_by !== user.id) {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Not your page</h1>
        <Link href={`/dashboard`} className="btn-secondary">Back to dashboard</Link>
      </div>
    );
  }

  const evRes = await listOrganiserEvents(id);
  const events = "events" in evRes ? evRes.events : [];

  return (
    <div className="container-page py-10 max-w-3xl">
      <Link
        href={`/dashboard/organiser/${id}/edit`}
        className="text-sm text-buzz-mute hover:text-buzz-accent transition"
      >
        ← Back to {organiser.name}
      </Link>
      <p className="eyebrow mt-3 mb-1">Organiser events</p>
      <h1 className="h-display text-3xl sm:text-4xl mb-2">
        Events for {organiser.name}
      </h1>
      <p className="text-buzz-mute mb-6 max-w-xl text-sm">
        Take ownership of an existing gig (e.g. one our scrapers added at the
        venue you're promoting at), or add a brand-new gig. New events go to
        admin for review before they appear publicly — usually approved within
        24 hours.
      </p>

      <OrganiserEventsClient
        organiserId={id}
        organiserName={organiser.name}
        initialEvents={events}
      />
    </div>
  );
}
