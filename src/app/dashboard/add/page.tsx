import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add to The Buzz Kids" };

// "Which are you?" — the first onboarding step. Sends venue owners to the
// place-setup flow and activity organisers (who run clubs/classes at places
// they don't own) to the organiser flow, so nobody's forced to "own a venue"
// they only run a session at.
export default async function AddChooserPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/add");

  return (
    <div className="container-page py-10 max-w-3xl">
      <Link href="/dashboard" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to dashboard
      </Link>
      <p className="eyebrow mt-3 mb-2">Add to The Buzz Kids</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-3">What are you adding?</h1>
      <p className="text-buzz-mute mb-8 max-w-xl">
        Pick whichever fits — you can always add the other later.
      </p>

      <div className="grid sm:grid-cols-2 gap-4">
        <Link href="/dashboard/venue-setup" className="card-hover lift p-6 flex flex-col gap-3 border-buzz-accent/30">
          <span className="text-4xl" aria-hidden>📍</span>
          <h2 className="font-display text-2xl uppercase">A place</h2>
          <p className="text-sm text-buzz-mute">
            You own or manage somewhere families visit — a soft play, farm, museum,
            leisure centre, café or attraction.
          </p>
          <span className="mt-auto pt-2 text-buzz-accent font-medium">Set up a place →</span>
        </Link>

        <Link href="/dashboard/organiser-setup" className="card-hover lift p-6 flex flex-col gap-3 border-buzz-accent/30">
          <span className="text-4xl" aria-hidden>🎪</span>
          <h2 className="font-display text-2xl uppercase">Activities or clubs</h2>
          <p className="text-sm text-buzz-mute">
            You run sessions, classes or clubs — often at places you don't own (a
            baby group at a community centre, a holiday camp at a leisure centre).
          </p>
          <span className="mt-auto pt-2 text-buzz-accent font-medium">Set up as an organiser →</span>
        </Link>
      </div>
    </div>
  );
}
