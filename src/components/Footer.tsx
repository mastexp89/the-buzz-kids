import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function Footer() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let role: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles").select("role").eq("id", user.id).maybeSingle();
    role = profile?.role ?? null;
  }

  // Pick the cities link dynamically — links to the city directly when only
  // one is active, otherwise back to the homepage so users pick.
  const { data: activeCities } = await supabase
    .from("cities")
    .select("name, slug")
    .eq("active", true)
    .order("name");
  const cities = activeCities ?? [];
  const browseHref = cities.length === 1 ? `/${cities[0].slug}` : "/";
  // "Browse Locations" rather than "Browse cities" — many of our city
  // rows are actually regions (Angus, Fife) that cover multiple towns,
  // so "cities" sells them short.
  const browseLabel = cities.length === 1 ? `Browse ${cities[0].name}` : "Browse Locations";

  return (
    <footer className="border-t border-buzz-border mt-16 bg-buzz-bg">
      <div className="container-page py-10 flex flex-col sm:flex-row items-center sm:items-start sm:justify-between gap-6">
        <div className="flex flex-col items-center sm:items-start gap-2">
          <div className="flex items-center gap-2">
            <span className="font-script text-xl text-buzz-accent leading-none">The Buzz Kids</span>
          </div>
          <div className="text-xs text-buzz-mute">© {new Date().getFullYear()} The Buzz Kids. Things to do with the kids.</div>
          <div className="text-xs text-buzz-mute">
            A sister site to{" "}
            <a
              href="https://www.thebuzzguide.co.uk"
              target="_blank"
              rel="noopener"
              className="hover:text-buzz-accent transition underline-offset-2 hover:underline"
            >
              The Buzz Guide
            </a>
            . Designed by{" "}
            <a
              href="https://www.forthhost.com"
              target="_blank"
              rel="noopener"
              className="hover:text-buzz-accent transition underline-offset-2 hover:underline"
            >
              Forth Host &amp; Web Design
            </a>
          </div>
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-buzz-mute">
          <Link href="/about" className="hover:text-buzz-accent transition">About</Link>
          <Link href={browseHref} className="hover:text-buzz-accent transition">{browseLabel}</Link>
          <Link href="/privacy" className="hover:text-buzz-accent transition">Privacy</Link>
          {user ? (
            <>
              <Link href="/dashboard" className="hover:text-buzz-accent transition">Dashboard</Link>
              {role === "admin" && (
                <Link href="/admin" className="hover:text-buzz-accent transition">Admin</Link>
              )}
            </>
          ) : (
            <>
              <Link href="/signup" className="hover:text-buzz-accent transition">List an activity</Link>
              <Link href="/login" className="hover:text-buzz-accent transition">Sign in</Link>
            </>
          )}
        </nav>
      </div>
    </footer>
  );
}
