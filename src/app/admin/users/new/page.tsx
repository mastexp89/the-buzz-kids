import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import NewUserForm from "./NewUserForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add an account — The Buzz Kids admin" };

export default async function NewUserPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/users/new");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/admin" className="btn-secondary mt-6 inline-block">Back to admin</Link>
      </div>
    );
  }

  return (
    <div className="container-page py-10 max-w-xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">← Back to admin</Link>
      <p className="eyebrow mt-4 mb-1">Accounts</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">Add an account</h1>
      <p className="text-buzz-mute mb-6 max-w-lg">
        Create a login directly — handy for setting up an editor (contributor) without them
        having to sign up first. The account is ready to use straight away.
      </p>
      <NewUserForm />
    </div>
  );
}
