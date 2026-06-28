"use client";

// Compact gallery strip with click-to-lightbox.
// Used on the venue page to keep "what's on" above the fold while still
// showing photos. Up to N thumbnails inline, "+ N more" tile if there are more,
// click any → fullscreen lightbox with prev/next + ESC to close.

import { useEffect, useState } from "react";

export default function VenueGallery({
  images,
  inlineCount = 6,
  compact = false,
}: {
  images: string[];
  inlineCount?: number;
  // When true, force a 3-column grid at every breakpoint — used in the
  // sidebar where the available width is narrow regardless of viewport.
  // Default (false) keeps the wider 3→6 column responsive grid used
  // when the gallery has the full page width to itself.
  compact?: boolean;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  // Keyboard nav while the lightbox is open
  useEffect(() => {
    if (openIndex === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenIndex(null);
      if (e.key === "ArrowRight") setOpenIndex((i) => (i === null ? null : (i + 1) % images.length));
      if (e.key === "ArrowLeft")
        setOpenIndex((i) => (i === null ? null : (i - 1 + images.length) % images.length));
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [openIndex, images.length]);

  if (!images || images.length === 0) return null;

  const visible = images.slice(0, inlineCount);
  const overflow = Math.max(0, images.length - inlineCount);

  return (
    <>
      <div className={compact ? "grid grid-cols-3 gap-2" : "grid grid-cols-3 sm:grid-cols-6 gap-2"}>
        {visible.map((src, i) => {
          const isLast = i === visible.length - 1 && overflow > 0;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setOpenIndex(i)}
              className="group relative aspect-square rounded-lg overflow-hidden bg-buzz-surface border border-buzz-border hover:border-buzz-accent transition"
              aria-label={`Photo ${i + 1} of ${images.length}`}
            >
              <div
                className="absolute inset-0 group-hover:scale-105 transition"
                style={{ backgroundImage: `url(${src})`, backgroundSize: "cover", backgroundPosition: "center" }}
              />
              {isLast && (
                <div className="absolute inset-0 bg-black/65 backdrop-blur-[1px] grid place-items-center text-white font-bold text-sm">
                  +{overflow} more
                </div>
              )}
            </button>
          );
        })}
      </div>

      {openIndex !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/95 grid place-items-center"
          onClick={() => setOpenIndex(null)}
          role="dialog"
          aria-modal="true"
        >
          {/* Close */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpenIndex(null); }}
            className="absolute top-4 right-4 w-11 h-11 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur text-white grid place-items-center text-xl"
            aria-label="Close"
          >
            ✕
          </button>
          {/* Counter */}
          <div className="absolute top-4 left-4 text-white/80 text-sm font-medium">
            {openIndex + 1} / {images.length}
          </div>
          {/* Prev */}
          {images.length > 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpenIndex((openIndex - 1 + images.length) % images.length); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur text-white grid place-items-center text-2xl"
              aria-label="Previous"
            >
              ‹
            </button>
          )}
          {/* Next */}
          {images.length > 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpenIndex((openIndex + 1) % images.length); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur text-white grid place-items-center text-2xl"
              aria-label="Next"
            >
              ›
            </button>
          )}
          {/* Image */}
          <img
            src={images[openIndex]}
            alt=""
            onClick={(e) => e.stopPropagation()}
            className="max-w-[92vw] max-h-[88vh] object-contain rounded-lg shadow-2xl"
          />
        </div>
      )}
    </>
  );
}
