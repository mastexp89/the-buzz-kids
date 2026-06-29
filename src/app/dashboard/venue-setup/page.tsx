import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyVenueStatus } from "./actions";
import VenueSetupClient from "./VenueSetupClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add a venue — The Buzz Kids" };

export default async function VenueSetupPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/venue-setup");

  // Block fans (role='user'). The signup flow now forces an explicit pick,
  // so this is only reachable by a fan typing the URL or following a stale
  // link. Bounce them back to their favourites with a friendly message.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role === "user") {
    return (
      <div className="container-page py-16 max-w-2xl text-center">
        <h1 className="h-display text-3xl mb-3">Venue setup is for venue owners</h1>
        <p className="text-buzz-mute mb-6 max-w-md mx-auto">
          You're signed up as a fan, so adding venues isn't part of your account.
          If you'd like to list a venue, get in touch with admin and we'll
          convert your account — or create a new account picking <strong>Venue</strong>{" "}
          at signup.
        </p>
        <Link href="/dashboard/favourites" className="btn-primary">
          Back to my favourites
        </Link>
      </div>
    );
  }

  const status = await getMyVenueStatus();
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
        {isFirstTime ? "Welcome to The Buzz Guide" : "Add another venue"}
      </p>
      <h1 className="h-display text-4xl sm:text-5xl mb-3">
        {isFirstTime ? "Set up your venue" : "Add a venue"}
      </h1>
      <p className="text-buzz-mute mb-6">
        {isFirstTime ? (
          <>
            Before we create a new page, let's check whether your venue's already
            on The Buzz Guide — many pubs already have an unowned page that an admin or
            our auto-importer added. If yours is one of them, claim it and you'll
            keep all its existing event history.
          </>
        ) : (
          <>
            Manage another venue too? Search for it first in case it's already
            on The Buzz Guide, otherwise create a new page.
          </>
        )}
      </p>

      {claimed.length > 0 && (
        <div className="card p-4 mb-8 border-buzz-accent/30">
          <p className="eyebrow text-[10px] mb-2">
            Your venue{claimed.length === 1 ? "" : "s"} so far ({claimed.length})
          </p>
          <ul className="flex flex-col gap-2">
            {claimed.map((v) => (
              <li key={v.id} className="flex items-center gap-3">
                {v.imageUrl ? (
                  <div
                    className="w-9 h-9 rounded bg-buzz-surface shrink-0 border border-buzz-border"
                    style={{
                      backgroundImage: `url(${v.imageUrl})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  />
                ) : (
                  <div className="w-9 h-9 rounded bg-buzz-surface shrink-0 border border-buzz-border grid place-items-center text-base">
                    🐝
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-display uppercase text-sm truncate">{v.name}</div>
                  <div className="text-xs text-buzz-mute">
                    {v.cityName ?? "—"}
                    {!v.approved && (
                      <span className="ml-2 text-buzz-accent">· awaiting approval</span>
                    )}
                  </div>
                </div>
                <Link
                  href={`/dashboard/venues/${v.id}`}
                  className="text-xs text-buzz-accent hover:text-buzz-accent2"
                >
                  Manage →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <VenueSetupClient
        suggestedName={status?.suggestedName ?? ""}
        cities={status?.cities ?? []}
      />
    </div>
  );
}
