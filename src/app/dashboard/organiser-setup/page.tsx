import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyOrganiserStatus } from "./actions";
import OrganiserSetupClient from "./OrganiserSetupClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add an organiser page — The Buzz Guide" };

export default async function OrganiserSetupPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/organiser-setup");

  // Block fans (role='user'). Mirrors venue-setup and setup pages — fans
  // can't elevate themselves into an organiser role by URL-typing.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role === "user") {
    return (
      <div className="container-page py-16 max-w-2xl text-center">
        <h1 className="h-display text-3xl mb-3">Organiser setup is for event organisers</h1>
        <p className="text-buzz-mute mb-6 max-w-md mx-auto">
          You're signed up as a fan, so adding an organiser page isn't part of your account.
          If you'd like to add one, get in touch with admin and we'll convert your account —
          or create a new account picking <strong>Event organiser</strong> at signup.
        </p>
        <Link href="/dashboard/favourites" className="btn-primary">
          Back to my favourites
        </Link>
      </div>
    );
  }

  const status = await getMyOrganiserStatus();
  const claimed = status?.claimed ?? [];
  const isFirstTime = claimed.length === 0;

  return (
    <div className="container-page py-10 max-w-2xl">
      <Link
        href="/dashboard"
        className="text-sm text-buzz-mute hover:text-buzz-accent transition"
      >
        ← Back to dashboard
      </Link>
      <p className="eyebrow mt-3 mb-2">
        {isFirstTime ? "Welcome to The Buzz Guide" : "Add another organiser"}
      </p>
      <h1 className="h-display text-4xl sm:text-5xl mb-3">
        {isFirstTime ? "Set up your organiser page" : "Add an organiser page"}
      </h1>
      <p className="text-buzz-mute mb-6">
        {isFirstTime ? (
          <>
            Before we create a new page, let's check whether your promoter / event
            company is already listed on The Buzz Guide. If so, claim it and you'll
            keep all its existing event history. Otherwise create a new page —
            it'll go live once an admin approves it.
          </>
        ) : (
          <>
            Run more than one promoter brand? Add another organiser page. Each one
            has its own bio, photo, socials and event history. You manage them all
            from this account.
          </>
        )}
      </p>

      {claimed.length > 0 && (
        <div className="card p-4 mb-8 border-buzz-accent/30">
          <p className="eyebrow text-[10px] mb-2">
            Your organiser page{claimed.length === 1 ? "" : "s"} so far ({claimed.length})
          </p>
          <ul className="flex flex-col gap-2">
            {claimed.map((o) => (
              <li key={o.id} className="flex items-center gap-3">
                {o.imageUrl ? (
                  <div
                    className="w-9 h-9 rounded bg-buzz-surface shrink-0 border border-buzz-border"
                    style={{
                      backgroundImage: `url(${o.imageUrl})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  />
                ) : (
                  <div className="w-9 h-9 rounded bg-buzz-surface shrink-0 border border-buzz-border grid place-items-center text-base">
                    📋
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-display uppercase text-sm truncate">{o.name}</div>
                  {!o.approved && (
                    <div className="text-xs text-buzz-accent">awaiting approval</div>
                  )}
                </div>
                <Link
                  href={`/organisers/${o.slug}`}
                  target="_blank"
                  className="text-xs text-buzz-mute hover:text-buzz-accent"
                >
                  View ↗
                </Link>
                <Link
                  href={`/dashboard/organiser/${o.id}/edit`}
                  className="text-xs text-buzz-accent hover:text-buzz-accent2"
                >
                  Edit
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <OrganiserSetupClient suggestedName={status?.suggestedName ?? ""} />
    </div>
  );
}
