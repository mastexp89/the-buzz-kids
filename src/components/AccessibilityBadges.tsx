import Link from "next/link";
import { ACCESS_FACETS, facetsFor } from "@/lib/accessibility";

// Badges shown on a listing (event card, event page, venue page) for the
// accessibility / sensory facets it offers. `size="sm"` renders icon-only
// pills (with a tooltip) for tight spaces like cards; the default shows
// icon + label.
export function AccessibilityBadges({
  items,
  size = "md",
}: {
  items: string[] | null | undefined;
  size?: "sm" | "md";
}) {
  const facets = facetsFor(items);
  if (facets.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Accessibility and sensory features">
      {facets.map((f) =>
        size === "sm" ? (
          <span
            key={f.key}
            title={`${f.label} — ${f.desc}`}
            className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-buzz-surface border border-buzz-border text-sm leading-none"
            aria-label={f.label}
          >
            <span aria-hidden>{f.icon}</span>
          </span>
        ) : (
          <span
            key={f.key}
            className="inline-flex items-center gap-1.5 rounded-full bg-buzz-surface border border-buzz-border px-2.5 py-1 text-xs font-medium text-buzz-text"
          >
            <span aria-hidden>{f.icon}</span>
            {f.label}
          </span>
        ),
      )}
    </div>
  );
}

// Compact legend explaining the icons — shown at the top of listings pages.
// Links through to the full /accessibility guide.
export function AccessibilityLegend() {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm font-semibold text-buzz-text">
          <span aria-hidden>♿</span> Accessibility &amp; sensory icons
        </p>
        <Link
          href="/accessibility"
          className="text-xs text-buzz-accent hover:text-buzz-accent2 whitespace-nowrap"
        >
          Full guide →
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-2">
        {ACCESS_FACETS.map((f) => (
          <div key={f.key} className="flex items-center gap-2 text-xs text-buzz-mute">
            <span aria-hidden className="text-sm leading-none">{f.icon}</span>
            <span className="truncate">{f.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
