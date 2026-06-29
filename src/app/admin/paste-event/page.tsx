import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canContribute } from "@/lib/roles";
import PasteEventClient from "./PasteEventClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paste a post → event — The Buzz Kids admin" };

export default async function PasteEventPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/paste-event");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!canContribute(me?.role)) {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Staff only</h1>
        <Link href="/dashboard" className="btn-secondary mt-6 inline-block">Back to dashboard</Link>
      </div>
    );
  }

  const [{ data: cities }, { data: genres }] = await Promise.all([
    supabase.from("cities").select("id, name").order("name"),
    supabase.from("genres").select("slug, name").order("name"),
  ]);

  return (
    <div className="container-page py-10 max-w-2xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">← Back to admin</Link>
      <p className="eyebrow mt-4 mb-1">Paste a post</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">Facebook → event</h1>
      <p className="text-buzz-mute mb-6 max-w-xl">
        Found a good event in a Facebook group? Paste the post text below (and the poster image
        link if there is one). We&apos;ll pull out the event details for you to check and publish —
        no retyping.
      </p>
      <PasteEventClient cities={cities ?? []} genres={genres ?? []} />
    </div>
  );
}
