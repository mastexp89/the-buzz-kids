// Single source of truth for the accessibility / sensory facets used across
// the site — the badges on listings, the legend at the top of the listings
// page, and the /accessibility guide. Keys match the controlled vocab stored
// in events.accessibility[] (migration 066) and venues.accessibility[] (068)
// and emitted by the Claude extractor.

export type AccessFacetKey =
  | "autism-friendly"
  | "sensory-session"
  | "quiet-space"
  | "ear-defenders"
  | "changing-places"
  | "carer-free"
  | "wheelchair-accessible"
  | "buggy-friendly"
  | "bsl"
  | "makaton";

export type AccessFacet = {
  key: AccessFacetKey;
  label: string;   // short pill label
  icon: string;    // emoji (matches the site's playful icon style)
  desc: string;    // one-line meaning, shown in the legend + guide
};

// Order matters — this is the order badges + the legend render in.
export const ACCESS_FACETS: AccessFacet[] = [
  { key: "autism-friendly", label: "Autism / ASN friendly", icon: "🌈", desc: "Relaxed or ASN sessions with lower stimulation." },
  { key: "sensory-session", label: "Sensory sessions", icon: "✨", desc: "Dedicated sensory-friendly sessions or spaces." },
  { key: "quiet-space", label: "Quiet space", icon: "🤫", desc: "A calm room to use if your child gets overwhelmed." },
  { key: "ear-defenders", label: "Ear defenders", icon: "🎧", desc: "Ear defenders available to borrow." },
  { key: "changing-places", label: "Changing Places toilet", icon: "🚻", desc: "A full Changing Places toilet on site." },
  { key: "carer-free", label: "Free carer entry", icon: "🎟️", desc: "Free entry for a carer or companion." },
  { key: "wheelchair-accessible", label: "Wheelchair access", icon: "♿", desc: "Step-free wheelchair access." },
  { key: "buggy-friendly", label: "Buggy friendly", icon: "🚼", desc: "Buggy access and parking." },
  { key: "bsl", label: "BSL", icon: "🤟", desc: "British Sign Language supported." },
  { key: "makaton", label: "Makaton", icon: "👐", desc: "Makaton signing supported." },
];

const FACET_BY_KEY: Record<string, AccessFacet> = Object.fromEntries(
  ACCESS_FACETS.map((f) => [f.key, f]),
);

// Given a raw accessibility[] array (any strings), return the known facets in
// canonical order. Unknown values are dropped so junk can't render.
export function facetsFor(values: string[] | null | undefined): AccessFacet[] {
  if (!values || values.length === 0) return [];
  const set = new Set(values);
  return ACCESS_FACETS.filter((f) => set.has(f.key));
}

// Questions worth a quick call before visiting with a child who has
// additional needs — our own wording, shown on the /accessibility guide.
export const ACCESS_QUESTIONS: string[] = [
  "Do you put on any quieter or relaxed sessions for kids who find busy places tricky — and when are they?",
  "When's your calmest hour? We'd rather come along when it's a bit quieter.",
  "Can a pram or wheelchair get around everywhere, including the play areas and any upstairs bits?",
  "What are the toilets like — is there a Changing Places, or an accessible one with a bench?",
  "Could we borrow ear defenders, or do you keep a sensory pack handy on the day?",
  "If my little one needs a breather, is there a calm corner or quiet room we can slip away to?",
  "Does a carer or helper get in free — and how does that work when we arrive?",
  "Anything loud or sudden we should prep them for? Hand dryers, tannoys, a show, that sort of thing.",
  "We've got some dietary needs — are we OK to bring our own snacks or lunch?",
  "From the car park or bus stop to the front door — is the whole route step-free and pram-friendly?",
];
