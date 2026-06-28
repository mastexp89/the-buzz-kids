import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import VenueForm from "@/app/dashboard/venues/VenueForm";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function AdminNewVenuePage({ params }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") redirect("/dashboard");

  const { id: targetId } = await params;
  const { data: target } = await supabase
    .from("profiles")
    .select("id, email, display_name")
    .eq("id", targetId)
    .single();
  if (!target) notFound();

  const { data: cities } = await supabase
    .from("cities")
    .select("*")
    .eq("active", true)
    .order("name");

  return (
    <div className="container-page py-10 max-w-3xl">
      <Link href={`/admin/users/${target.id}`} className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to {target.display_name || target.email}
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin · Add venue for owner</p>
      <h1 className="h-display text-4xl mb-2">Add a venue</h1>
      <p className="text-buzz-mute mb-8 max-w-xl">
        This venue will be assigned to <strong className="text-buzz-text">{target.display_name || target.email}</strong>.
        They'll see it in their dashboard once it's created.
      </p>
      <VenueForm
        venue={null}
        cities={cities ?? []}
        ownerOverride={target.id}
        redirectAfterCreate={`/admin/users/${target.id}`}
      />
    </div>
  );
}
