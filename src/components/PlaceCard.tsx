import Link from "next/link";
import { AccessibilityBadges } from "@/components/AccessibilityBadges";
import { summaryBadges as deriveSummary } from "@/lib/accessibility";

// "Ages 3+" / "Up to 8s" / "All ages" for a place.
function ageLabel(min: number | null | undefined, max: number | null | undefined): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `Ages ${min}–${max}`;
  if (min != null) return `Ages ${min}+`;
  return `Up to ${max}s`;
}

function priceLabel(p: any): string | null {
  if (p.is_free) return "Free";
  if (p.price_from != null) return `From £${Number(p.price_from) % 1 === 0 ? Number(p.price_from) : Number(p.price_from).toFixed(2)}`;
  if (p.price_note) return p.price_note;
  return null;
}

const SETTING_LABEL: Record<string, string> = {
  indoor: "Indoor",
  outdoor: "Outdoor",
  both: "Indoor & outdoor",
};

export default function PlaceCard({ place, citySlug }: { place: any; citySlug: string }) {
  const photo =
    place.cover_photo_url ||
    place.image_url ||
    (Array.isArray(place.gallery_image_urls) ? place.gallery_image_urls[0] : null) ||
    place.logo_url ||
    null;

  const categories: { name: string; slug: string }[] = place.categories ?? [];
  const badges = deriveSummary(place.accessibility, place.age_min);
  const age = ageLabel(place.age_min, place.age_max);
  const price = priceLabel(place);
  const setting = place.setting ? SETTING_LABEL[place.setting] : null;

  return (
    <Link
      href={`/${citySlug}/venues/${place.slug}`}
      className="card-hover group flex flex-col lift overflow-hidden"
    >
      {/* Photo with summary badges over it */}
      <div
        className="relative h-44 bg-buzz-surface"
        style={
          photo
            ? { backgroundImage: `url(${photo})`, backgroundSize: "cover", backgroundPosition: "center" }
            : undefined
        }
      >
        {!photo && (
          <div className="absolute inset-0 grid place-items-center text-5xl opacity-60" aria-hidden>🐝</div>
        )}
        {badges.length > 0 && (
          <div className="absolute top-2 right-2 flex flex-col items-end gap-1.5">
            {badges.map((b) => (
              <span
                key={b.key}
                className="inline-flex items-center gap-1 rounded-full text-white text-[11px] font-semibold px-2.5 py-1 shadow-sm"
                style={{ backgroundColor: b.bg }}
              >
                <span aria-hidden>{b.icon}</span>
                {b.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="p-5 flex flex-col gap-2 flex-1">
        {categories[0] && (
          <p className="text-[11px] font-bold uppercase tracking-wider text-buzz-accent">
            {categories[0].name}
          </p>
        )}
        <h3 className="font-display text-xl uppercase leading-tight group-hover:text-buzz-accent transition">
          {place.name}
        </h3>
        {place.description && (
          <p className="text-sm text-buzz-mute line-clamp-2">{place.description}</p>
        )}

        <div className="mt-auto flex flex-col gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {age && (
              <span className="inline-flex items-center rounded-full bg-buzz-surface border border-buzz-border px-2.5 py-1 text-[11px] font-medium">
                {age}
              </span>
            )}
            {setting && (
              <span className="inline-flex items-center rounded-full bg-buzz-surface border border-buzz-border px-2.5 py-1 text-[11px] font-medium">
                {setting}
              </span>
            )}
            {price && (
              <span className="ml-auto text-xs font-semibold" style={{ color: place.is_free ? "#2E9E33" : undefined }}>
                {price}
              </span>
            )}
          </div>
          <AccessibilityBadges items={place.accessibility} size="sm" />
        </div>
      </div>
    </Link>
  );
}
