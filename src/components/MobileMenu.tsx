"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type Item = { href: string; label: string; accent?: boolean };

export default function MobileMenu({
  items,
  signedIn,
}: {
  items: Item[];
  signedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // Close menu when navigating
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="sm:hidden flex flex-col gap-[5px] p-2 rounded-lg hover:bg-buzz-card transition"
      >
        <span className={`block w-5 h-[2px] bg-buzz-text transition ${open ? "translate-y-[7px] rotate-45" : ""}`} />
        <span className={`block w-5 h-[2px] bg-buzz-text transition ${open ? "opacity-0" : ""}`} />
        <span className={`block w-5 h-[2px] bg-buzz-text transition ${open ? "-translate-y-[7px] -rotate-45" : ""}`} />
      </button>

      {/* Drawer */}
      <div
        className={`sm:hidden fixed inset-0 top-16 z-40 transition-opacity ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        style={{ backgroundColor: "rgba(0,0,0,0.97)" }}
        onClick={() => setOpen(false)}
      >
        <nav
          className="flex flex-col p-6 gap-1 text-lg bg-black h-full"
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((it) => {
            const isCurrent = pathname === it.href;
            return (
              <Link
                key={it.href}
                href={it.href}
                onClick={(e) => {
                  // If user taps the page they're already on, close the menu
                  // and force a refresh so something visible happens.
                  if (isCurrent) {
                    e.preventDefault();
                    setOpen(false);
                    router.refresh();
                  }
                  // Otherwise let next/link handle the navigation; the
                  // pathname-change effect will close the menu.
                }}
                className={`px-3 py-4 rounded-lg hover:bg-buzz-card transition border-b border-buzz-border/50 ${
                  it.accent ? "text-buzz-accent font-semibold" : ""
                }`}
              >
                {it.label}
              </Link>
            );
          })}
          {signedIn && (
            <form action="/auth/signout" method="post" className="mt-3">
              <button className="px-3 py-3 rounded-lg hover:bg-buzz-card transition w-full text-left text-buzz-mute">
                Sign out
              </button>
            </form>
          )}
        </nav>
      </div>
    </>
  );
}
