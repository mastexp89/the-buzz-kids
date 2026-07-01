import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SuggestionsClient from "./SuggestionsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit suggestions — The Buzz Kids admin" };

export default async function SuggestionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/suggestions");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/admin" className="btn-secondary mt-6 inline-block">Back to admin</Link>
      </div>
    );
  }

  const { data: suggestions } = await supabase
    .from("edit_suggestions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  return (
    <div className="container-page py-10 max-w-3xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">← Back to admin</Link>
      <p className="eyebrow mt-4 mb-1">From visitors</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">Edit suggestions</h1>
      <p className="text-buzz-mute mb-6 max-w-xl">
        Corrections to places and events, plus new-place requests from the
        <strong className="text-buzz-text"> List your activity</strong> form. Fix the listing,
        then mark it done. A ✋ means someone says they run the place.
      </p>
      <SuggestionsClient suggestions={(suggestions ?? []) as any} />
    </div>
  );
}
