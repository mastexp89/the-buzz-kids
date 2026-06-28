// Shared constants for the sponsor outreach tool. Kept out of actions.ts
// because Next.js' "use server" rule only permits async function exports
// from server-action files — exporting a const array from actions.ts
// fails the production build with "Failed to collect page data".

// Business types the search form offers as one-click presets. Each preset
// becomes one Brave query: `"{type}" {city} site:facebook.com`.
export const BUSINESS_TYPE_PRESETS = [
  "hairdresser",
  "barber",
  "hair salon",
  "beauty salon",
  "nail salon",
  "tattoo studio",
] as const;
