import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ListingSignupForm from "@/components/ListingSignupForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "List your activity — The Buzz Kids",
  description:
    "List your soft play, club, class, farm or holiday camp on The Buzz Kids — free. Reach local families looking for things to do.",
  alternates: { canonical: "/list-your-activity" },
};

export default async function ListYourActivityPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Already signed in? Skip the account step — straight to the place wizard.
  if (user) {
    redirect("/dashboard/venue-setup");
  }

  return (
    <div className="container-page py-12 max-w-2xl">
      <p className="eyebrow mb-1">For clubs, places &amp; activity providers</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-3">
        List your activity<span className="text-buzz-accent">.</span>
      </h1>
      <p className="text-buzz-mute mb-6 max-w-xl">
        Free to list and manage. Set up your account below, then add your place —
        sessions, opening times, prices and accessibility info — and reach local
        families looking for things to do this weekend, this holiday and beyond.
      </p>

      <ListingSignupForm
        loggedIn={false}
        defaultEmail=""
        defaultName=""
        loginNext="/dashboard/venue-setup"
      />

      <p className="text-sm text-buzz-mute mt-6">
        Is your place already on The Buzz Kids? Find it and use{" "}
        <strong className="text-buzz-text">“Claim this listing”</strong> instead, or{" "}
        <Link href="/browse" className="text-buzz-accent hover:underline">browse the directory</Link>.
      </p>
    </div>
  );
}
