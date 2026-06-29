import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyArtistStatus } from "./actions";
import SetupClient from "./SetupClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add an artist page — The Buzz Kids" };

export default async function SetupPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/setup");

  // Block fans (role='user'). Mirrors the guard on /dashboard/venue-setup —
  // accidental fans shouldn't be able to elevate themselves into an artist
  // role by URL-typing past the dashboard sidebar (which already hides the
  // entry point for them).
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role === "user") {
    return (
      <div className="container-page py-16 max-w-2xl text-center">
        <h1 className="h-display text-3xl mb-3">Artist setup is for musicians</h1>
        <p className="text-buzz-mute mb-6 max-w-md mx-auto">
          You're signed up as a fan, so adding an artist page isn't part of your account.
          If you'd like to add one, get in touch with admin and we'll convert your account —
          or create a new account picking <strong>Artist / Band / DJ</strong> at signup.
        </p>
        <Link href="/dashboard/favourites" className="btn-primary">
          Back to my favourites
        </Link>
      </div>
    );
  }

  const status = await getMyArtistStatus();
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
        {isFirstTime ? "Welcome to The Buzz Guide" : "Add another band"}
      </p>
      <h1 className="h-display text-4xl sm:text-5xl mb-3">
        {isFirstTime ? "Set up your artist page" : "Add an artist page"}
      </h1>
      <p className="text-buzz-mute mb-6">
        {isFirstTime ? (
          <>
            Before you submit gigs, let's make sure you're not creating a duplicate page.
            Many bands already have a page on The Buzz Guide that an admin or another musician
            added — if yours is one of them, claim it instead of creating a new one
            (you'll keep all the existing event history that way).
          </>
        ) : (
          <>
            Play in more than one band? Add another artist page. Each one has its
            own bio, photo, socials and gig history. You manage them all from this account.
          </>
        )}
      </p>

      {/* Show what they've already got — so they don't accidentally re-claim
          one of their own. */}
      {claimed.length > 0 && (
        <div className="card p-4 mb-8 border-buzz-accent/30">
          <p className="eyebrow text-[10px] mb-2">
            Your band{claimed.length === 1 ? "" : "s"} so far ({claimed.length})
          </p>
          <ul className="flex flex-col gap-2">
            {claimed.map((a) => (
              <li key={a.id} className="flex items-center gap-3">
                {a.image_url ? (
                  <div
                    className="w-9 h-9 rounded bg-buzz-surface shrink-0 border border-buzz-border"
                    style={{
                      backgroundImage: `url(${a.image_url})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  />
                ) : (
                  <div className="w-9 h-9 rounded bg-buzz-surface shrink-0 border border-buzz-border grid place-items-center text-base">
                    🎤
                  </div>
                )}
                <span className="font-display uppercase text-sm flex-1 truncate">
                  {a.name}
                </span>
                <Link
                  href={`/artists/${a.slug}`}
                  target="_blank"
                  className="text-xs text-buzz-mute hover:text-buzz-accent"
                >
                  View ↗
                </Link>
                <Link
                  href={`/dashboard/artist/${a.id}/edit`}
                  className="text-xs text-buzz-accent hover:text-buzz-accent2"
                >
                  Edit
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <SetupClient suggestedName={status?.suggestedName ?? ""} />
    </div>
  );
}
