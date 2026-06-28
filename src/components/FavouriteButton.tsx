"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleFavourite, type FavouriteTarget } from "@/lib/favourites";

// Heart button. Used on every venue / artist / organiser / event detail
// page. Optimistic UI flips the heart on click before the server returns.
//
// For logged-out users, clicking redirects to /login with the current
// page set as the next destination — so after sign-in they land back on
// the same page and can favourite for real.

export default function FavouriteButton({
  targetType,
  targetId,
  initialFavourited,
  signedIn,
  size = "md",
  showLabel = true,
}: {
  targetType: FavouriteTarget;
  targetId: string;
  initialFavourited: boolean;
  signedIn: boolean;
  size?: "sm" | "md";
  showLabel?: boolean;
}) {
  const router = useRouter();
  const [favourited, setFavourited] = useState(initialFavourited);
  const [busy, startTransition] = useTransition();

  const handleClick = () => {
    if (!signedIn) {
      // Redirect to login with this page as the post-login destination
      const next =
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}`
          : "/";
      router.push(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    const next = !favourited;
    setFavourited(next); // optimistic
    startTransition(async () => {
      const res = await toggleFavourite(targetType, targetId);
      if ("error" in res) {
        setFavourited(!next); // revert
      } else {
        // Server is source of truth — sync just in case
        setFavourited(res.favourited);
      }
    });
  };

  const dims = size === "sm" ? "w-8 h-8" : "w-9 h-9";
  const iconSize = size === "sm" ? 14 : 16;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      aria-label={favourited ? "Remove from favourites" : "Add to favourites"}
      aria-pressed={favourited}
      title={
        !signedIn
          ? "Sign in to save"
          : favourited
          ? "Remove from favourites"
          : "Add to favourites"
      }
      className={
        showLabel
          ? `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition disabled:opacity-50 ${
              favourited
                ? "bg-rose-500/15 border-rose-500/50 text-rose-300 hover:bg-rose-500/25"
                : "bg-buzz-card border-buzz-border text-buzz-mute hover:border-buzz-accent hover:text-buzz-accent"
            }`
          : `inline-flex items-center justify-center ${dims} rounded-full border transition disabled:opacity-50 ${
              favourited
                ? "bg-rose-500/15 border-rose-500/50 text-rose-300 hover:bg-rose-500/25"
                : "bg-buzz-card border-buzz-border text-buzz-mute hover:border-buzz-accent hover:text-buzz-accent"
            }`
      }
    >
      <HeartIcon filled={favourited} size={iconSize} />
      {showLabel && <span>{favourited ? "Saved" : "Save"}</span>}
    </button>
  );
}

function HeartIcon({ filled, size }: { filled: boolean; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}
