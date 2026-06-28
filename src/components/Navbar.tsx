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
    { href: "/browse", label: "Browse all" },
    { href: "/surprise", label: "🎲 Surprise me" },
    { href: "/about", label: "About" },
    { href: "/accessibility", label: "Sensory & Access" },
    { href: "/signup?as=venue", label: "List an activity" },
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
        <Link href="/" className="group leading-none shrink-0" aria-label="The Buzz Kids — home">
          <span className="font-display text-3xl sm:text-3xl tracking-tight whitespace-nowrap">
            <span className="text-buzz-text">The Buzz </span>
            <span style={{ color: "#EC1E8C" }}>K</span>
            <span style={{ color: "#1FA9E0" }}>i</span>
            <span style={{ color: "#6FA713" }}>d</span>
            <span style={{ color: "#F9A11B" }}>s</span>
          </span>
        </Link>

        <nav className="hidden sm:flex items-center gap-2 text-sm font-medium">
          <Link href="/" className="px-3 py-2 rounded-lg hover:bg-buzz-card transition">Home</Link>
          <Link href="/browse" className="px-3 py-2 rounded-lg hover:bg-buzz-card transition">Browse all</Link>
<Link href="/about" className="px-3 py-2 rounded-lg hover:bg-buzz-card transition">About</Link>
          <Link href="/accessibility" className="px-3 py-2 rounded-lg hover:bg-buzz-card transition">Sensory &amp; Access</Link>
          <Link href="/signup?as=venue" className="px-3 py-2 rounded-lg hover:bg-buzz-card transition">List an activity</Link>
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
