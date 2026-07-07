import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TrackedLink from "@/components/TrackedLink";

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
      {/* Cross-promo to the grown-ups' sister site — on every page via the footer. */}
      <div className="border-b border-buzz-border bg-buzz-card">
        <div className="container-page py-4 flex flex-col sm:flex-row items-center justify-center gap-3 text-center text-sm">
          <span className="text-buzz-mute">
            Need a night off? <strong className="text-buzz-text">The Buzz Guide</strong>{" "}
            is our grown-ups' sister site — live music, nights out and events across Scotland.
          </span>
          <TrackedLink
            href="https://www.thebuzzguide.co.uk"
            kind="click_buzzguide"
            source="footer_banner"
            target="_blank"
            rel="noopener"
            className="btn-secondary !py-1.5 !px-4 whitespace-nowrap shrink-0"
          >
            Visit The Buzz Guide →
          </TrackedLink>
        </div>
      </div>

      <div className="container-page py-10 flex flex-col sm:flex-row items-center sm:items-start sm:justify-between gap-6">
        <div className="flex flex-col items-center sm:items-start gap-2">
          <span className="font-display text-2xl tracking-tight leading-none">
            <span className="text-buzz-text">The Buzz </span>
            <span style={{ color: "#EC1E8C" }}>K</span>
            <span style={{ color: "#1FA9E0" }}>i</span>
            <span style={{ color: "#6FA713" }}>d</span>
            <span style={{ color: "#F9A11B" }}>s</span>
          </span>
          <div className="text-xs text-buzz-mute">© {new Date().getFullYear()} The Buzz Kids. Things to do with the kids.</div>
          <div className="text-xs text-buzz-mute text-center sm:text-left">
            A sister site to{" "}
            <TrackedLink href="https://www.thebuzzguide.co.uk" kind="click_buzzguide" source="footer_credit" target="_blank" rel="noopener" className="text-buzz-accent hover:underline underline-offset-2 transition">
              The Buzz Guide
            </TrackedLink>
            .<br />
            Designed by{" "}
            <a href="https://www.forthhost.com" target="_blank" rel="noopener" className="text-buzz-accent hover:underline underline-offset-2 transition">
              Forth Host &amp; Web Design
            </a>
          </div>
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-buzz-mute">
          <Link href="/about" className="hover:text-buzz-accent transition">About</Link>
          <Link href="/accessibility" className="hover:text-buzz-accent transition">Accessibility</Link>
          <Link href="/privacy" className="hover:text-buzz-accent transition">Privacy</Link>
          {user && role === "admin" ? (
            <Link href="/admin" className="hover:text-buzz-accent transition">Admin</Link>
          ) : null}
        </nav>
      </div>
    </footer>
  );
}
