"use client";

// Small square thumbnail used by EventCard, with onError fallback so
// broken poster URLs (typically rotted Facebook signed URLs) flip to
// the themed icon instead of rendering as a black square.

import { useState } from "react";

export default function EventThumb({
  imageUrl,
  icon,
  size = "w-16 h-16 sm:w-20 sm:h-20",
}: {
  imageUrl: string | null;
  icon: string;
  size?: string;
}) {
  const [broken, setBroken] = useState(false);
  const showFallback = !imageUrl || broken;

  return (
    <div className={`${size} rounded-lg overflow-hidden shrink-0 bg-buzz-surface border border-buzz-border`}>
      {showFallback ? (
        <div className="w-full h-full grid place-items-center bg-gradient-to-br from-buzz-card to-buzz-bg text-3xl text-buzz-accent/70">
          {icon}
        </div>
      ) : (
        <img
          src={imageUrl}
          alt=""
          onError={() => setBroken(true)}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      )}
    </div>
  );
}
