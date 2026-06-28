import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listThreadForAdmin, markAdminThreadRead } from "@/lib/messages-actions";
import AdminThreadClient from "./AdminThreadClient";

export const dynamic = "force-dynamic";

export default async function AdminThreadPage({ params }: { params: Promise<{ userId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("profiles").select("role, email").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin" || me?.email?.toLowerCase() !== "dylanwilliamson@gmail.com") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Not authorised</h1>
        <Link href="/admin" className="btn-secondary mt-6 inline-block">Back to admin</Link>
      </div>
    );
  }

  const { userId } = await params;
  const r = await listThreadForAdmin(userId);
  if ("error" in r) notFound();
  // Mark user-sent messages as read on view
  await markAdminThreadRead(userId).catch(() => {});

  return (
    <div className="container-page py-10 max-w-3xl">
      <Link href="/admin/messages" className="text-sm text-buzz-mute hover:text-buzz-accent transition">← All conversations</Link>
      <p className="eyebrow mt-3 mb-1">Admin · Message thread</p>
      <h1 className="h-display text-3xl sm:text-4xl mb-1">
        {r.user.display_name ?? r.user.email ?? "—"}
      </h1>
      <p className="text-buzz-mute text-sm mb-6">
        {r.user.email} · {r.user.role}
      </p>
      <AdminThreadClient userId={userId} initialMessages={r.messages} />
    </div>
  );
}
