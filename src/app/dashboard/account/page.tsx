import { createClient } from "@/lib/supabase/server";
import AccountForms from "./AccountForms";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return (
    <div className="flex flex-col gap-8 max-w-2xl">
      <div>
        <p className="eyebrow mb-1">Your account</p>
        <h1 className="h-display text-4xl">Account settings</h1>
      </div>

      <AccountForms
        currentEmail={user.email ?? ""}
        displayName={profile?.display_name ?? ""}
        role={profile?.role ?? "venue_owner"}
      />
    </div>
  );
}
