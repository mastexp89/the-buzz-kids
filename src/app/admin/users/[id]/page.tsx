import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import UserDetailClient from "./UserDetailClient";

export const dynamic = "force-dynamic";

export default async function AdminUserDetail({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/dashboard" className="btn-secondary mt-6 inline-block">Back</Link>
      </div>
    );
  }

  const { id } = await params;

  const [{ data: target }, { data: venues }, { data: artists }, { data: otherOwners }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, display_name, role, created_at")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("venues")
      .select("id, name, slug, approved, created_at, city:cities(name, slug)")
      .eq("owner_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("artists")
      .select("id, name, slug, approved, created_at")
      .eq("claimed_by", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, email, display_name")
      .neq("id", id)
      .order("email"),
  ]);

  if (!target) notFound();

  return (
    <div className="container-page py-10 max-w-4xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>

      <p className="eyebrow mt-4 mb-1">User</p>
      <h1 className="h-display text-3xl sm:text-4xl mb-1">
        {target.display_name || <span className="text-buzz-mute italic">— no display name —</span>}
      </h1>
      <p className="text-buzz-mute text-sm mb-8">
        {target.email} · joined {target.created_at ? new Date(target.created_at).toLocaleDateString("en-GB") : "?"}
      </p>

      <UserDetailClient
        target={target}
        venues={(venues ?? []) as any}
        artists={(artists ?? []) as any}
        otherOwners={(otherOwners ?? []) as any}
        isCurrentUser={user.id === target.id}
      />
    </div>
  );
}
