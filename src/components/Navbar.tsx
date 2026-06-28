import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import MobileMenu from "./MobileMenu";
import SearchBox from "./SearchBox";

export default async function Navbar() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let role: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    role = profile?.role ?? null;
  }

  const mobileItems: { href: string; label: string; accent?: boolean }[] = [
    { href: "/", label: "Home" },
    { href: "/about", label: "About" },
    { href: "/artists", label: "Artists" },
    { href: "/sponsors", label: "Sponsors" },
    { href: "/advertise", label: "Advertise" },
    { href: "/pricing", label: "Pricing" },
  ];
  if (user) {
    mobileItems.push({ href: "/dashboard", label: "Dashboard" });
    if (role === "admin") mobileItems.push({ href: "/admin", label: "Admin", accent: true });
    mobileItems.push({ href: "/dashboard/account", label: "Account settings" });
  } else {
    mobileItems.push({ href: "/login", label: "Sign in" });
    mobileItems.push({ href: "/signup", label: "Sign up free", accent: true });
  }

  return (
    <header className="border-b border-buzz-border bg-buzz-bg sticky top-0 z-30">
      <div className="container-page h-16 flex items-center justify-between gap-2">
        <Link href="/" className="group leading-none shrink-0">
          <span className="font-script text-2xl sm:text-4xl text-buzz-accent group-hover:text-buzz-accent2 transition whitespace-nowrap">
            The Buzz Guide
          </span>
        </Link>

        <nav className="hidden sm:flex items-center gap-2 text-sm font-medium">
          <Link href="/" className="px-3 py-2 rounded-lg hover:bg-buzz-card transition">Home</Link>
          <Link href="/about" className="px-3 py-2 rounded-lg hover:bg-buzz-card transition">About</Link>
          <Link href="/artists" className="px-3 py-2 rounded-lg hover:bg-buzz-card transition">Artists</Link>
          <Link href="/sponsors" className="px-3 py-2 rounded-lg hover:bg-buzz-card transition">Sponsors</Link>
          <Link href="/advertise" className="px-3 py-2 rounded-lg hover:bg-buzz-card transition">Advertise</Link>
          {user ? (
            <>
              <Link href="/dashboard" className="px-3 py-2 rounded-lg hover:bg-buzz-card transition">Dashboard</Link>
              {role === "admin" && (
                <Link href="/admin" className="px-3 py-2 rounded-lg hover:bg-buzz-card transition text-buzz-accent">Admin</Link>
              )}
              <form action="/auth/signout" method="post">
                <button className="btn-ghost">Sign out</button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="px-3 py-2 rounded-lg hover:bg-buzz-card transition">Sign in</Link>
              <Link href="/signup" className="btn-primary">Sign up free</Link>
            </>
          )}
        </nav>

        <div className="flex items-center gap-1">
          <SearchBox />
          <MobileMenu items={mobileItems} signedIn={!!user} />
        </div>
      </div>
    </header>
  );
}
