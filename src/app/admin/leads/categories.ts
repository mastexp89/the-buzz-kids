// Shared constant — lives in its own file because Next.js refuses to import
// non-async values from a "use server" file. Both actions.ts (server) and
// page.tsx (server component) import this.

export const LEAD_CATEGORIES = [
  {
    slug: "taxi",
    label: "Taxi firms & private hire",
    emoji: "🚖",
    searches: ["taxi", "private hire"],
  },
  {
    slug: "takeaway",
    label: "Takeaways & late-night food",
    emoji: "🍕",
    searches: ["takeaway", "kebab shop", "fish and chips"],
  },
  {
    slug: "brewery",
    label: "Breweries & drink brands",
    emoji: "🍺",
    searches: ["brewery", "distillery"],
  },
  {
    slug: "music-shop",
    label: "Music shops & instrument hire",
    emoji: "🎸",
    searches: ["music shop", "musical instrument shop"],
  },
  {
    slug: "promoter",
    label: "Promoters & tour managers",
    emoji: "🎟",
    searches: ["event promoter", "concert promoter"],
  },
  {
    slug: "barber-salon",
    label: "Barbers, tattoo studios, salons",
    emoji: "💈",
    searches: ["barber shop", "hair salon", "tattoo studio"],
  },
  {
    slug: "hotel-bar",
    label: "Hotels & late-night bars",
    emoji: "🏨",
    searches: ["hotel", "cocktail bar"],
  },
  {
    slug: "studio",
    label: "Recording studios & rehearsal rooms",
    emoji: "🎤",
    searches: ["recording studio", "rehearsal room"],
  },
] as const;

export type LeadCategorySlug = typeof LEAD_CATEGORIES[number]["slug"];
