import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import SignupsClient from "./SignupsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coming-soon signups — The Buzz Kids admin" };

export default async function SignupsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/signups");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/admin" className="btn-secondary mt-6 inline-block">Back to admin</Link>
      </div>
    );
  }

  const sb = createServiceClient();
  const { data: signups } = await sb
    .from("notify_signups")
    .select("email, created_at")
    .order("created_at", { ascending: false })
    .limit(10000);

  return (
    <div className="container-page py-10 max-w-3xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">← Back to admin</Link>
      <p className="eyebrow mt-4 mb-1">Email</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">Mailing list</h1>
      <p className="text-buzz-mute mb-6 max-w-xl">
        The pre-launch waitlist plus everyone who ticked "keep me posted" on the suggest-an-edit,
        list-your-activity and suggest-a-deal forms. This is the list the newsletter tool sends to.
        (Email captures, not accounts — parent accounts live under{" "}
        <Link href="/admin" className="text-buzz-accent hover:underline">People</Link>.)
      </p>
      <SignupsClient signups={(signups ?? []) as any} />
    </div>
  );
}
