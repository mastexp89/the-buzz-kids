import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("[Stripe] STRIPE_SECRET_KEY is not set in env. Checkout + webhooks will fail until it is.");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-12-18.acacia" as any,
  typescript: true,
});

// Pricing — single source of truth.
// Subscription is £5/week with a 0-day Stripe trial because we manage the trial ourselves
// via the venue's `trial_ends_at` column. Promotions are one-off charges.
export const PRICING = {
  subscription: {
    amount_cents: 500, // £5
    currency: "gbp",
    interval: "week" as const,
    name: "The Buzz Guide — Venue listing",
    description: "Weekly subscription to keep your venue listed on The Buzz Guide.",
  },
  promotions: {
    featured_pin: {
      amount_cents: 1000,  // £10 — pin a gig at the top of city listings for 7 days
      duration_days: 7,
      name: "Featured pin",
      description: "Pin one of your gigs to the very top of the Dundee city listings for 7 days.",
    },
    spotlight: {
      amount_cents: 1500,  // £15 — venue spotlight on home for 7 days
      duration_days: 7,
      name: "Venue spotlight",
      description: "Your venue featured in the Spotlight section of the home page for 7 days.",
    },
    highlighted_gig: {
      amount_cents: 500,   // £5 — yellow border + glow on a gig for 7 days
      duration_days: 7,
      name: "Highlighted gig",
      description: "Honey-gold border + glow effect on your gig card for 7 days.",
    },
    genre_takeover: {
      amount_cents: 800,   // £8 — top of genre filter for 7 days
      duration_days: 7,
      name: "Genre takeover",
      description: "Your gig appears first when fans filter by its tagged genre, for 7 days.",
    },
    weekend_boost: {
      amount_cents: 600,   // £6 — Weekend pick badge for 7 days
      duration_days: 7,
      name: "Weekend boost",
      description: "Eye-catching 'Weekend pick' badge on your gig for the upcoming weekend.",
    },
  },
} as const;

export type PromotionKind = keyof typeof PRICING.promotions;
