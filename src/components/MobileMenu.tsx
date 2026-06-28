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
      {/* Backdrop */}
      {open && (
        <div
          className="sm:hidden fixed inset-0 top-16 z-40 bg-black/40"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer */}
      <nav
        className={`sm:hidden fixed top-16 right-0 bottom-0 z-50 w-72 bg-buzz-bg border-l border-buzz-border flex flex-col p-6 gap-1 text-lg transition-transform ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((it) => {
          const isCurrent = pathname === it.href;
          return (
            <Link
              key={it.href}
              href={it.href}
              onClick={(e) => {
                if (isCurrent) {
                  e.preventDefault();
                  setOpen(false);
                  router.refresh();
                }
              }}
              className={`px-3 py-4 rounded-lg hover:bg-buzz-card transition border-b border-buzz-border/50 text-buzz-text ${
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
    </>
  );
}
