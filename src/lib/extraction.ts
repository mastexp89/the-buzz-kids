// AI event extraction — pure helper. No DB, no auth, no side effects.
// Takes a venue + a "post" (text + image URLs + posted-at timestamp) and
// returns the structured events Claude pulls out of it.
//
// Used by the manual upload route and (later) the FB / website scrapers.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_EXTRACTION_MODEL ?? "claude-sonnet-4-6";

// Single retry-with-backoff helper shared by every Anthropic call in
// this file. Anthropic rate-limits free / low-tier orgs at 30k input
// tokens/min; with image-heavy requests we can blow past that and
// 429 everything. Retrying with the server's `retry-after` (or a sensible
// default) lets us pace through the bucket rather than fail-fast.
//
// 4xx errors that aren't 429 (auth, malformed body, content policy)
// short-circuit — fail fast so the caller logs the real cause instead
// of burning 4 sleeps before reporting it.
async function callAnthropicWithRetry(apiKey: string, body: object): Promise<Response> {
  const MAX_RETRIES = 4;
  let res: Response | null = null;
  let lastErrorText = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return res;
    const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
    if (!retryable || attempt === MAX_RETRIES) {
      lastErrorText = await res.text();
      break;
    }
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
      ? Math.min(retryAfterSec * 1000, 30_000)
      : Math.min(2_000 * Math.pow(2, attempt), 30_000);
    try { await res.text(); } catch { /* swallow drain */ }
    await new Promise((r) => setTimeout(r, waitMs));
  }
  const text = lastErrorText || (res ? await res.text() : "no response");
  throw new Error(`Anthropic ${res?.status ?? "?"}: ${text.slice(0, 400)}`);
}

export type ExtractionInput = {
  venueName: string;
  postedAt: string; // ISO datetime — anchors "tonight", "Sunday" etc.
  textContent?: string | null;
  imageUrls?: string[];
  availableCategories?: { slug: string; name: string }[];
  // Optional geographic restriction. When set, the AI is told to skip any
  // event whose venue is not in `city` or one of `nearbyAreas`. Used by the
  // multi-venue site importer where the source page may list events across
  // multiple cities. Leave undefined for the FB / venue-website scrapers
  // where the venue is already pinned.
  locationFilter?: {
    city: string;
    nearbyAreas?: string[];
  };
  // When true, the model may ALSO classify the source as an ongoing place /
  // attraction (a farm, park, museum) rather than a dated event, returning it
  // in a `places` array. Used by the aggregator importer. Default false — every
  // existing caller behaves exactly as before.
  detectPlaces?: boolean;
};

// Controlled vocab for accessibility / sensory facets — mirrors the
// events.accessibility text[] in migration 066. The model is told to use
// ONLY these, and normalizeExtractedEvent drops anything off-list.
export const ACCESSIBILITY_FACETS = [
  "autism-friendly", "sensory-session", "quiet-space", "ear-defenders",
  "changing-places", "carer-free", "wheelchair-accessible", "buggy-friendly",
  "bsl", "makaton",
] as const;
export type AccessibilityFacet = (typeof ACCESSIBILITY_FACETS)[number];

// One extracted kids'/family event. Field names mirror the events table
// (migration 066) so persistence is a near 1:1 map:
//   recurring  -> recurrence_pattern / recurrence_until
//   categories -> event_genres join (the genres table reused as categories)
export type ExtractedEvent = {
  title: string;
  starts_at: string;       // ISO Europe/London — first session's start
  ends_at: string | null;  // first session's end
  // Last day of a multi-day RUN (a Mon–Fri holiday camp). null = single day.
  end_date: string | null; // YYYY-MM-DD
  // A repeating series (a weekly club). null = one-off / camp (use end_date).
  recurring: { pattern: string; until: string | null } | null;
  categories: string[];    // slugs from availableCategories
  description: string;
  // Age suitability in WHOLE YEARS. 0 = from birth. null = unspecified / all ages.
  age_min: number | null;
  age_max: number | null;
  // Price as written ("£4", "Free", "£8 / £6 conc"). null if not stated.
  cover_charge: string | null;
  is_free: boolean;        // clearly free to attend
  price_from: number | null; // lowest numeric £ a child needs; 0 if free; null if unknown
  booking_required: boolean;
  // Direct booking / ticket URL if visible. null otherwise.
  ticket_url: string | null;
  // Indoor / outdoor — the rain-backup filter.
  setting: "indoor" | "outdoor" | "both" | null;
  // Accessibility / sensory facets explicitly stated (from ACCESSIBILITY_FACETS).
  accessibility: AccessibilityFacet[];
  confidence: number;
  evidence: string;
  // 0-based index into the input images that is the FLYER / POSTER for this
  // event. null for a plain caption or a generic venue photo.
  poster_image_index: number | null;
  // Venue / organiser name detected on the poster, if any. null if absent.
  venue_hint: string | null;
};

// An ongoing attraction / venue (not a dated event), surfaced only when
// detectPlaces is set — routed to the Places queue, not the events queue.
export type ExtractedPlace = {
  name: string;
  location: string | null;   // town / area printed on the page
  description: string;
  website: string | null;
  family_suitable: boolean;  // false = adults-only / not for kids
  confidence: number;
};

export type ExtractionResult = {
  events: ExtractedEvent[];
  places: ExtractedPlace[];
  raw: any;
};

function normalizeExtractedPlace(raw: any): ExtractedPlace | null {
  const name = typeof raw?.name === "string" ? raw.name.trim() : "";
  if (!name) return null;
  const conf = Number(raw?.confidence);
  return {
    name,
    location: typeof raw?.location === "string" && raw.location.trim() ? raw.location.trim() : null,
    description: typeof raw?.description === "string" ? raw.description.trim() : "",
    website: typeof raw?.website === "string" && /^https?:\/\//.test(raw.website) ? raw.website.trim() : null,
    family_suitable: raw?.family_suitable !== false,
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5,
  };
}

function buildSystemPrompt(
  venueName: string,
  postedIso: string,
  availableCategories: { slug: string; name: string }[],
  locationFilter?: ExtractionInput["locationFilter"],
  detectPlaces?: boolean,
): string {
  const postedHuman = new Date(postedIso).toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
  const categoryLine =
    availableCategories.length > 0
      ? availableCategories.map((c) => `${c.slug} (${c.name})`).join(", ")
      : "(none configured — leave categories as [])";
  return `You extract kids' & family events from a Scottish venue/organiser's social-media post or website for The Buzz Kids, a family activities & events directory (soft play, holiday clubs, library crafts, farm days, kids' theatre, sports camps, classes, days out).

VENUE / ORGANISER: ${venueName}
POSTED: ${postedHuman} (${postedIso}, Europe/London)

AVAILABLE CATEGORIES (use these slugs ONLY): ${categoryLine}

Return ONLY a JSON object of this shape:
{
  "events": [
    {
      "title": "string — short, plain, no emojis or marketing fluff",
      "starts_at": "ISO 8601 datetime in Europe/London (e.g. 2026-07-14T10:00:00+01:00)",
      "ends_at": "ISO 8601 datetime or null",
      "end_date": "YYYY-MM-DD (last day of a multi-day run) or null",
      "recurring": null OR { "pattern": "weekly|weekdays|daily|every_saturday|...", "until": "YYYY-MM-DD or null" },
      "categories": ["slug1", "slug2"],
      "age_min": whole years or null,
      "age_max": whole years or null,
      "cover_charge": "price as written or null",
      "is_free": true or false,
      "price_from": lowest numeric £ or null,
      "booking_required": true or false,
      "ticket_url": "booking URL or null",
      "setting": "indoor | outdoor | both | null",
      "accessibility": ["autism-friendly", "..."],
      "description": "one neutral sentence",
      "confidence": 0.0-1.0,
      "evidence": "brief quote of where you got the date/time from",
      "poster_image_index": 0,
      "venue_hint": "string or null"
    }
  ]${detectPlaces ? `,
  "places": [
    {
      "name": "the attraction / venue name",
      "location": "town or area, or null",
      "description": "one neutral sentence about what it is",
      "website": "its own website URL or null",
      "family_suitable": true or false,
      "confidence": 0.0-1.0
    }
  ]` : ""}
}
${detectPlaces ? `
PLACES vs EVENTS (this source is a listings page — classify each item into ONE bucket)
- A PLACE is a PERMANENT attraction families can visit REGULARLY — open year-round or a full season with regular opening hours: a farm park, soft play, museum, play centre, nature reserve, leisure centre, adventure park, visitor centre. Put it in "places", NOT "events". Do NOT invent a dated event for it.
- If the item is a dated, time-boxed HAPPENING — a show, class, camp, competition, festival, workshop, gala, a holiday programme with start/end dates, a one-off day out — it is an EVENT. Put it in "events".
- LIMITED-DATE OPENINGS ARE EVENTS, NOT PLACES. A private garden or house that opens only on specific dates or a handful of days — e.g. Scotland's Gardens Scheme / National Garden Scheme openings, "open Sat & Sun", charity/one-off open days — is a dated EVENT, not a place. Never put these in "places". If it has clear dates, put it in "events"; if it's mainly an adult garden viewing with nothing for kids, drop it (don't return it at all).
- A fixed attraction described as "open daily over the summer" with regular hours is a PLACE, not a camp.
- family_suitable: set false ONLY for clearly adults-only items (18+, licensed bar night, wine tasting, adult comedy, grown-up-only talks, adult garden viewing). Keep anything a parent could reasonably bring a child to — family gigs, outdoor festivals, markets, panto, fun runs — as true. Items you mark family_suitable=false will be dropped.
` : ""}
DATES & TIMES
- Resolve relative dates ("today", "this Saturday", "Sat 14th", "the summer holidays") using POSTED above.
- If a date has no year, assume the next occurrence from POSTED.
- Single times: "10am" / "from 10:30am" / "doors 9:45, starts 10am" → starts_at set (the start, not doors), ends_at null.
- TIME RANGES MUST populate BOTH starts_at and ends_at — don't drop the end side:
  * "10am - 11:30am"   → starts_at 10:00, ends_at 11:30
  * "1pm – 2pm"        → starts_at 13:00, ends_at 14:00 (en-dash, em-dash, hyphen, "to" or "until" all count)
  * "10:30am to 12"    → starts_at 10:30, ends_at 12:00
- Multi-slot on the same poster (e.g. a morning AND an afternoon session): each slot gets its own event row.

MULTI-DAY & RECURRING (important — kids' events are usually NOT single one-offs)
- HOLIDAY CAMP over consecutive days (e.g. "Football camp Mon–Fri 14–18 July, 10am–3pm daily"):
  return ONE event. starts_at = first day's start (14 Jul 10:00), ends_at = first day's end (14 Jul 15:00),
  end_date = last day (2026-07-18), recurring = null. (end_date captures the run.)
- WEEKLY / ONGOING CLUB (e.g. "Toddler dance every Saturday 9:30am, term-time"):
  return ONE event. starts_at = the NEXT occurrence after POSTED, recurring = { pattern: "every_saturday",
  until: <YYYY-MM-DD if an end date is stated, else null> }, end_date = null.
- Daily over a single holiday week at the same time → treat like a camp (use end_date), unless it's clearly a
  permanently-open attraction rather than a dated activity.
- A genuine one-off session → end_date null, recurring null.
- NEVER emit one row per occurrence of a recurring/multi-day thing — always collapse to ONE row.

CATEGORIES
- Pick 1–3 matching slugs from AVAILABLE CATEGORIES. Do NOT invent slugs not in that list.
- Match the activity: soft-play session → soft-play; farm/animal visit → farm-animals; library craft → library + arts-crafts;
  football camp → sports-camp + football; panto/kids show → theatre; messy/sensory play → sensory; forest school → forest-nature;
  coding/Lego robotics → stem-coding; toddler group → toddler-group; swimming lessons → swimming.
- If nothing fits, use ["free-play"] only as a last resort. Never leave categories empty; never invent a slug.

AGE SUITABILITY (the #1 parent filter — extract whenever stated or clearly implied)
- age_min / age_max are WHOLE YEARS. age_min 0 = suitable from birth (babies).
- "Ages 4–8" → 4, 8.  "Suitable 5+" → 5, null.  "Under 5s" → 0, 4.  "Up to 12" → null, 12.
- "Toddlers" → 1, 3.  "Babies" / "0–18 months" → 0, 1.  "Pre-school" → 2, 4.  "Primary age" → 5, 11.  "Teens" → 12, 17.
- "All ages" / "family" / "all the family" → null, null (no restriction).
- If no age is stated or implied, use null for both — don't invent a range.

PRICE
- cover_charge: the price exactly as written ("£4", "£5 per child", "£8 / £6 conc", "Free entry", "Donations welcome"). null if not stated. Don't normalise the wording.
- is_free: true ONLY when clearly free to attend (free entry / no charge). Otherwise false. Unknown price → false.
- price_from: the LOWEST numeric £ amount a child needs (prefer the child ticket). "£5 per child, adults free" → 5. "£8 / £6 conc" → 6. "Free" → 0. Unknown → null.

BOOKING
- booking_required: true if it says you must book / pre-book / booking essential / limited spaces book ahead / ticketed in advance. false for clear drop-ins ("just turn up", "no need to book"). If unstated, false.
- ticket_url: a direct booking/ticket link if visible (the venue's own /book page, eventbrite, bookwhen, ticketsource, class4kids, skiddle, etc.). Bare homepages / the page being scraped do NOT count → null.

INDOOR / OUTDOOR
- setting: "indoor" (soft play, library, cinema, indoor class), "outdoor" (park, farm trail, forest, sports pitch), "both" (venue/event explicitly using indoor + outdoor), or null if genuinely unclear.

ACCESSIBILITY / SENSORY (only when explicitly mentioned — never assume)
- Add any the post states, from this list ONLY: "autism-friendly" (autism/ASN-friendly or relaxed session),
  "sensory-session" (sensory-specific session), "quiet-space" (quiet/calm room), "ear-defenders" (provided),
  "changing-places" (Changing Places toilet), "carer-free" (free carer/companion entry),
  "wheelchair-accessible", "buggy-friendly" (buggy access/parking), "bsl" (BSL interpreted), "makaton".
- [] if none are mentioned.

DEDUPLICATION (very important)
- The SAME event mentioned in the caption AND on a poster AND on another page = ONE event. Input is a single source of truth even when text/images repeat.
- A recurring weekly/daily session, or a multi-day camp, = ONE row with recurring/end_date set, NOT one per occurrence.
- Same title + same date/time = same event. Don't return both.

DO NOT EXTRACT
- Generic "we're open" / opening-hours-only posts (unless it's a specific dated holiday session), past-event recaps, thank-yous.
- Private birthday-party hire with no public session anyone can attend.
- Staff news, job ads, merch/raffle posts, fundraising appeals with no activity for kids to attend.

CONFIDENCE GUIDE
- 0.9+ : explicit date AND time AND clear title
- 0.7–0.9 : two of the three explicit, one inferred
- 0.5–0.7 : significant inference required
- < 0.5 : do not return — leave it out

VENUE HINT
- Set "venue_hint" to the venue / organiser name printed on the poster, if any. null if not shown.
- VENUE above may be a placeholder — read the poster independently and report the name you actually see.

${locationFilter ? `LOCATION FILTER (HARD RULE — skip non-matching events entirely)
- ONLY return events in ${locationFilter.city}${(locationFilter.nearbyAreas && locationFilter.nearbyAreas.length > 0) ? ` or ${locationFilter.nearbyAreas.join(", ")}` : ""}.
- If the poster / page text mentions any other UK town/city (e.g. Glasgow, Edinburgh, Aberdeen, Stirling, Perth, Inverness, London, Manchester, Liverpool, Birmingham, Leeds, Newcastle, Belfast, Cardiff, Bristol, Falkirk, St Andrews, Forfar, Arbroath, Kirriemuir, Carnoustie, Monifieth) — and that place ISN'T in the allowed list above — DO NOT return that event. Drop it silently.
- Touring shows: a kids' theatre tour might list multiple towns. Only return the ${locationFilter.city} date(s); skip every other town.
- If you genuinely can't tell which town an event is in, DO return it (better to surface for human review than silently drop). The admin can reject it after.
- This filter applies BEFORE all other rules.` : ""}

POSTER IMAGE
- Set "poster_image_index" to the 0-based index of which input image is the FLYER / POSTER for this specific event (the artwork advertising it — usually shows the title, date/time, age, sometimes a price).
- A generic venue photo, soft-play interior shot, staff selfie, or repeated logo is NOT a poster — return null.
- If several events share one "what's on this week" graphic, use the same index for each.
- If no images were provided, or none is clearly a poster, set poster_image_index to null.

If nothing event-like, return { "events": []${detectPlaces ? `, "places": []` : ""} }.`;
}

// Anthropic rejects images whose raw bytes exceed 5 MB. Phone-camera
// posters routinely come in at 6-12 MB, so before sending we transparently
// downscale anything over the threshold via sharp. The user just sees
// "Reading gigs from poster..." — no error, no upload-twice dance.
//
// Buffer is intentionally below 5 MB (Anthropic's limit) to leave headroom
// for the base64 expansion overhead they apparently sometimes count too.
const ANTHROPIC_IMAGE_MAX_BYTES = 4_500_000; // ~4.3 MB

// Lazy-import sharp so the module isn't paid for on cold-starts that
// don't hit image extraction (admin pages, public pages, etc.).
async function compressForAnthropic(
  buf: Buffer,
  originalMediaType: string,
): Promise<{ media_type: string; buf: Buffer }> {
  const { default: sharp } = await import("sharp");

  // Convert everything to JPEG — best size/quality ratio, and Anthropic
  // accepts JPEG natively. Try a few strategies in order of fidelity.
  // Each attempt reads the original buf (sharp instances are single-use).
  const attempts: Array<{ maxDim: number; quality: number }> = [
    { maxDim: 2400, quality: 85 },
    { maxDim: 2000, quality: 80 },
    { maxDim: 1600, quality: 75 },
    { maxDim: 1200, quality: 70 },
    { maxDim: 1024, quality: 60 },
  ];

  for (const a of attempts) {
    const out = await sharp(buf)
      .rotate() // honour EXIF orientation so phone posters aren't sideways
      .resize({
        width: a.maxDim,
        height: a.maxDim,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: a.quality, mozjpeg: true })
      .toBuffer();
    if (out.length <= ANTHROPIC_IMAGE_MAX_BYTES) {
      return { media_type: "image/jpeg", buf: out };
    }
  }

  // Shouldn't happen — even a 1024-wide JPEG at q60 is rarely over 200 KB —
  // but throw a clear error rather than send something Anthropic will reject.
  throw new Error(
    `Image too large even after aggressive compression (was ${(buf.length / 1024 / 1024).toFixed(1)} MB ${originalMediaType}). Try saving as JPEG and re-uploading.`,
  );
}

// Fetch an image from a URL on OUR server and return it as base64.
// Bypasses the robots.txt restrictions Anthropic's URL fetcher applies
// (FB / Instagram / many CDNs disallow it).
async function fetchImageAsBase64(
  url: string,
): Promise<{ media_type: string; data: string }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; TheBuzzBot/1.0; +https://www.thebuzzguide.co.uk)",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`Image fetch ${res.status}`);

  const contentType = res.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";")[0].trim() || "image/jpeg";
  const allowed = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
  if (!allowed.has(mediaType)) {
    throw new Error(`Unsupported image type ${mediaType}`);
  }

  // Typed as Buffer (no generic) so we can reassign with sharp's output —
  // sharp returns Buffer<ArrayBufferLike> which doesn't satisfy the narrower
  // Buffer<ArrayBuffer> that Buffer.from(ArrayBuffer) infers.
  let buf: Buffer = Buffer.from(await res.arrayBuffer());
  let outMediaType = mediaType;

  // Downscale anything over the Anthropic threshold. This used to be a
  // hard throw — but phone-camera posters routinely exceed 5 MB and the
  // resulting "extraction failed" was confusing for venue owners. sharp
  // resizes + recompresses to JPEG so the call succeeds transparently.
  if (buf.length > ANTHROPIC_IMAGE_MAX_BYTES) {
    const compressed = await compressForAnthropic(buf, mediaType);
    buf = compressed.buf;
    outMediaType = compressed.media_type;
  }

  return { media_type: outMediaType, data: buf.toString("base64") };
}

export type ExtractedVenueInfo = {
  address: string | null;     // Street address, multi-line OK
  postcode: string | null;    // UK postcode (DD1 1XX format)
  phone: string | null;       // Best public phone number (booking / general enquiries)
  email: string | null;       // Public email if available
  description: string | null; // 1-2 sentence venue blurb
};

/**
 * Extract a venue's contact / address / blurb info from scraped website text.
 * Used by the festival admin to auto-populate new venue records, and by the
 * "Auto-fill from website" button on the venue edit page.
 *
 * Conservative: returns null for any field it can't confidently identify.
 * Doesn't invent details.
 */
export async function extractVenueInfo(opts: {
  venueName: string;
  pageText: string;          // Concatenated text from the venue's homepage / contact page
}): Promise<ExtractedVenueInfo> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY env var missing.");

  const sys = `You extract a venue's contact details from text scraped off its website.

VENUE: ${opts.venueName}

Return ONLY this JSON:
{
  "address": "Street address as a single line, or null",
  "postcode": "UK postcode (e.g. DD1 1XX), or null",
  "phone": "Best public phone number, or null",
  "email": "Public email, or null",
  "description": "1-2 sentence neutral blurb about the venue, or null"
}

RULES
- ADDRESS: street + city if available. Drop building names, "Find us:", "Address:" prefixes. Single line.
- POSTCODE: UK format. Validate it looks plausible. null if not visible.
- PHONE: prefer general enquiries / bookings. Strip "tel:", spaces are OK. UK format if visible.
- EMAIL: prefer info@/bookings@/hello@. Skip personal emails / staff emails / partner emails.
- DESCRIPTION: 1-2 short sentences describing what the venue is and what it offers (e.g. "A pub in central Dundee with live music every Thursday and Friday."). Don't be promotional or use marketing fluff. Don't invent.
- If you genuinely can't find a value, set it to null. Don't guess.
- Return ONLY the JSON. No surrounding text.`;

  const userText = opts.pageText.slice(0, 8000); // Cap to control AI cost

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: sys,
      messages: [{ role: "user", content: userText }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 300)}`);
  }
  const json: any = await res.json();
  const block = (json.content ?? []).find((b: any) => b.type === "text");
  const responseText: string = block?.text ?? "";
  const m = responseText.match(/\{[\s\S]*\}/);
  if (!m) return { address: null, postcode: null, phone: null, email: null, description: null };
  try {
    const parsed = JSON.parse(m[0]);
    return {
      address: typeof parsed.address === "string" && parsed.address.trim() ? parsed.address.trim() : null,
      postcode: typeof parsed.postcode === "string" && parsed.postcode.trim() ? parsed.postcode.trim() : null,
      phone: typeof parsed.phone === "string" && parsed.phone.trim() ? parsed.phone.trim() : null,
      email: typeof parsed.email === "string" && parsed.email.trim() ? parsed.email.trim() : null,
      description: typeof parsed.description === "string" && parsed.description.trim() ? parsed.description.trim() : null,
    };
  } catch {
    return { address: null, postcode: null, phone: null, email: null, description: null };
  }
}

/**
 * Cheap focused call: given an event title + optional description, returns the
 * artist / band / DJ / host names it can pull out. Used by the backfill action
 * for existing events that were extracted before we added artist support.
 */
export async function extractArtistsFromTitle(opts: {
  venueName: string;
  title: string;
  description?: string | null;
}): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY env var missing.");

  const sys = `You extract artist / band / DJ / host names from a single gig title and description.

VENUE: ${opts.venueName}

Return ONLY this JSON: { "artists": ["Name", "Another Name"] }

RULES
- Only return real performer names: bands, solo artists, DJs, karaoke hosts (KJs), MCs.
- Include support acts and "+ guests" as separate entries when named.
- Tribute acts: keep the tribute name as-is ("ABBA Mania", "Oasish").
- Cover bands: their actual band name, not the songs they cover.
- Do NOT return generic words like "Live Music", "DJ", "Karaoke", "Quiz", "SPFL", "Champions League", venue names, day-of-week names.
- Do NOT invent names. If you can't tell, return [].
- Football match titles like "Arsenal vs Atletico": return [].
- Sports / quiz / generic karaoke (no host named): return [].`;

  const userText = `TITLE: ${opts.title}` + (opts.description ? `\nDESCRIPTION: ${opts.description}` : "");

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      system: sys,
      messages: [{ role: "user", content: userText }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
  }
  const json: any = await res.json();
  const textBlock = (json.content ?? []).find((b: any) => b.type === "text");
  const responseText: string = textBlock?.text ?? "";
  const m = responseText.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]);
    return Array.isArray(parsed.artists)
      ? parsed.artists.filter((s: any) => typeof s === "string" && s.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

// ============================================================
// Deal / offer extraction
//
// Given the text of a "kids eat free" / family-days-out roundup page, pull out
// the individual money-saving deals as structured offers for the Deals tab.
// We extract the FACT of each deal (chain X does kids-eat-free, the gist of the
// terms) — the admin verifies and publishes; we don't copy a source's curated
// list verbatim. Drafts land in the offers table as approved=false.
// ============================================================

export type ExtractedDeal = {
  title: string;                       // short, plain ("Kids eat free at Bella Italia")
  provider: string | null;            // the chain / business ("Bella Italia")
  description: string | null;         // one neutral sentence
  terms: string | null;               // the small print in plain English
  category: "food" | "days-out";
  scope: "national" | "local";
  region: string | null;              // town/area for LOCAL deals, else null
  url: string | null;                 // where to find/claim it
  business_url: string | null;        // the chain's own website
  ends_on: string | null;             // YYYY-MM-DD if clearly time-boxed, else null
  confidence: number;
};

function normalizeExtractedDeal(raw: any): ExtractedDeal | null {
  const title = typeof raw?.title === "string" ? raw.title.trim() : "";
  if (!title) return null;
  const str = (v: any): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  const url = (v: any): string | null =>
    typeof v === "string" && /^https?:\/\//.test(v.trim()) ? v.trim() : null;
  const cat = raw?.category === "days-out" ? "days-out" : "food";
  const scope = raw?.scope === "local" ? "local" : "national";
  const ends = typeof raw?.ends_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.ends_on) ? raw.ends_on : null;
  const conf = Number(raw?.confidence);
  return {
    title: title.slice(0, 160),
    provider: str(raw?.provider),
    description: str(raw?.description),
    terms: str(raw?.terms),
    category: cat,
    scope,
    region: scope === "local" ? str(raw?.region) : null,
    url: url(raw?.url),
    business_url: url(raw?.business_url),
    ends_on: ends,
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5,
  };
}

/**
 * Pull family money-saving deals out of a roundup / listings page's text.
 * `sourceUrl` is passed so the model can use it as a sensible default `url`.
 * `today` anchors relative end-dates ("until end of the summer holidays").
 */
export async function extractDeals(opts: {
  pageText: string;
  sourceUrl: string;
  today: string; // YYYY-MM-DD
}): Promise<ExtractedDeal[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY env var missing.");

  const sys = `You extract family money-saving DEALS from the text of a web page for The Buzz Kids, a Scottish family activities directory. Deals are standing offers that save families money: "kids eat free", "kids eat for £1", kids-go-free attraction entry, family tickets, voucher codes, 2-for-1s.

TODAY: ${opts.today}. SOURCE URL: ${opts.sourceUrl}

Return ONLY a JSON object of this shape:
{
  "deals": [
    {
      "title": "short plain deal name, e.g. 'Kids eat free at Bella Italia'",
      "provider": "the chain/business name, e.g. 'Bella Italia', or null",
      "description": "one neutral sentence describing the deal",
      "terms": "the key small print in plain English (days, ages, min spend, app needed), or null",
      "category": "food" | "days-out",
      "scope": "national" | "local",
      "region": "town/area name for LOCAL deals only, else null",
      "url": "the page to claim/see the deal, or null",
      "business_url": "the business's OWN website, or null",
      "ends_on": "YYYY-MM-DD if the deal clearly ends on a date, else null",
      "confidence": 0.0-1.0
    }
  ]
}

RULES
- category: "food" = eating out (kids eat free/£1 at restaurants/cafes). "days-out" = attractions, travel, tickets, memberships, days-out savings.
- scope: "national" = a UK-wide chain or scheme (Asda, Tesco, Bella Italia, ScotRail). "local" = a single independent Scottish business or a specific town's offer. If unsure, use "national".
- region: ONLY for local deals — the Scottish town/area it's in (e.g. "Dundee", "Fife"). null for national.
- terms: summarise the real conditions concisely and neutrally — do NOT copy long promotional paragraphs verbatim. Capture what a parent must know: which days, child ages, min adult spend, whether an app/voucher code is needed.
- ends_on: only set when a clear end date is stated (resolve "end of the summer holidays" etc. against TODAY). Ongoing/all-year deals → null.
- Extract each DISTINCT deal once. Skip duplicates, expired deals (ended before TODAY), affiliate spam, and anything that isn't a concrete family saving.
- Only Scotland-relevant deals: a national UK chain that operates in Scotland counts; an England-only regional offer does not.
- Be conservative — if the page doesn't clearly describe a real deal, return fewer. confidence < 0.5 → leave it out.
- Return ONLY the JSON. If nothing, return { "deals": [] }.`;

  const body = {
    model: MODEL,
    max_tokens: 4096,
    system: sys,
    messages: [{ role: "user", content: `PAGE TEXT:\n${opts.pageText.slice(0, 14000)}` }],
  };

  const res = await callAnthropicWithRetry(apiKey, body);
  const json: any = await res.json();
  const textBlock = (json.content ?? []).find((b: any) => b.type === "text");
  const responseText: string = textBlock?.text ?? "";
  const m = responseText.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]);
    const rows = Array.isArray(parsed?.deals) ? parsed.deals : [];
    return rows
      .map(normalizeExtractedDeal)
      .filter((d: ExtractedDeal | null): d is ExtractedDeal => !!d && d.confidence >= 0.5);
  } catch {
    return [];
  }
}

const ACCESSIBILITY_SET: Set<string> = new Set(ACCESSIBILITY_FACETS);
const SETTING_SET = new Set(["indoor", "outdoor", "both"]);

// Coerce a raw model object into a safe ExtractedEvent. Anything the model
// gets wrong — a string where we want a number, a setting/accessibility value
// that isn't in our vocab, an out-of-range age — falls back to a null/default
// here rather than propagating junk into the DB on persist.
function normalizeExtractedEvent(raw: any): ExtractedEvent {
  const str = (v: any): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  const num = (v: any): number | null => {
    const n = typeof v === "string" ? Number(v.replace(/[£,\s]/g, "")) : v;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  };
  const yrs = (v: any): number | null => {
    const n = num(v);
    return n === null ? null : Math.max(0, Math.min(18, Math.round(n)));
  };
  const isoDate = (v: any): string | null =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

  const isFree = raw?.is_free === true;
  let priceFrom = num(raw?.price_from);
  if (priceFrom !== null) priceFrom = Math.max(0, priceFrom);
  if (isFree && priceFrom === null) priceFrom = 0; // free ⇒ floor is £0

  const settingRaw = (str(raw?.setting) ?? "").toLowerCase();
  const conf = num(raw?.confidence);
  const pattern = raw?.recurring && typeof raw.recurring === "object" ? str(raw.recurring.pattern) : null;

  return {
    title: str(raw?.title) ?? "",
    starts_at: londonWallClockToUtc(str(raw?.starts_at)),
    ends_at: str(raw?.ends_at) ? londonWallClockToUtc(str(raw?.ends_at)) : null,
    end_date: isoDate(raw?.end_date),
    recurring: pattern ? { pattern, until: isoDate(raw?.recurring?.until) } : null,
    categories: Array.isArray(raw?.categories)
      ? raw.categories.filter((s: any) => typeof s === "string" && s.trim()).map((s: string) => s.trim())
      : [],
    description: str(raw?.description) ?? "",
    age_min: yrs(raw?.age_min),
    age_max: yrs(raw?.age_max),
    cover_charge: str(raw?.cover_charge),
    is_free: isFree,
    price_from: priceFrom,
    booking_required: raw?.booking_required === true,
    ticket_url: str(raw?.ticket_url),
    setting: SETTING_SET.has(settingRaw) ? (settingRaw as ExtractedEvent["setting"]) : null,
    accessibility: Array.isArray(raw?.accessibility)
      ? (Array.from(new Set(raw.accessibility.filter((s: any) => ACCESSIBILITY_SET.has(s)))) as AccessibilityFacet[])
      : [],
    confidence: conf === null ? 0 : Math.max(0, Math.min(1, conf)),
    evidence: str(raw?.evidence) ?? "",
    poster_image_index: Number.isInteger(raw?.poster_image_index) ? raw.poster_image_index : null,
    venue_hint: str(raw?.venue_hint),
  };
}

// Claude is asked to return Europe/London ISO with a +01:00/+00:00 offset, but
// it's unreliable about the offset (it often tags a 10am poster time as `Z`,
// which then reads as 11am in the UK and stores an hour off). So we IGNORE the
// offset it gave and treat the wall-clock time printed on the poster as
// Europe/London local, converting to the correct UTC instant deterministically.
// Whether Claude said "10:00+01:00", "10:00Z" or "10:00", the stored time is the
// same correct instant — which also stops the timezone-drift duplicates.
function londonOffsetMinutes(atUtcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const p = dtf.formatToParts(new Date(atUtcMs));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const localAsUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
  return Math.round((localAsUtc - atUtcMs) / 60000);
}

function londonWallClockToUtc(isoish: string | null | undefined): string {
  if (!isoish) return "";
  const m = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(isoish));
  if (!m) return String(isoish); // not a datetime we recognise — leave untouched
  const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5];
  let utcMs = Date.UTC(y, mo - 1, d, h, mi); // first guess: wall clock as if UTC
  utcMs -= londonOffsetMinutes(utcMs) * 60000; // wall clock is London-local → true UTC is earlier
  return new Date(utcMs).toISOString();
}

export async function extractEvents(input: ExtractionInput): Promise<ExtractionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY env var missing.");

  const content: any[] = [];
  if (input.textContent && input.textContent.trim()) {
    content.push({ type: "text", text: `POST CAPTION OR PAGE TEXT:\n${input.textContent.trim()}` });
  }
  const imageWarnings: string[] = [];
  for (const url of input.imageUrls ?? []) {
    if (!url) continue;
    try {
      const { media_type, data } = await fetchImageAsBase64(url);
      content.push({
        type: "image",
        source: { type: "base64", media_type, data },
      });
    } catch (e: any) {
      imageWarnings.push(`${url}: ${e?.message ?? "fetch failed"}`);
    }
  }
  if (imageWarnings.length > 0) {
    content.push({
      type: "text",
      text: `(Note: ${imageWarnings.length} image${imageWarnings.length === 1 ? " was" : "s were"} unreachable and skipped: ${imageWarnings.join("; ")})`,
    });
  }
  content.push({
    type: "text",
    text: 'Extract events from the above. Return ONLY a JSON object matching the schema in the system prompt.',
  });

  const body = {
    model: MODEL,
    max_tokens: 4096,
    system: buildSystemPrompt(input.venueName, input.postedAt, input.availableCategories ?? [], input.locationFilter, input.detectPlaces),
    messages: [{ role: "user", content }],
  };

  // Retry-with-backoff handled centrally — see callAnthropicWithRetry
  // near the top of this file. Anthropic rate-limits free / low-tier
  // orgs at 30k input tokens/min, and image-heavy posts blow past that
  // when several venues scrape simultaneously.
  const res = await callAnthropicWithRetry(apiKey, body);
  const json: any = await res.json();
  const textBlock = (json.content ?? []).find((b: any) => b.type === "text");
  const responseText: string = textBlock?.text ?? "";
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  const parsed: { events: ExtractedEvent[]; places: ExtractedPlace[] } = { events: [], places: [] };
  if (jsonMatch) {
    try {
      const rawParsed = JSON.parse(jsonMatch[0]);
      const rawEvents = Array.isArray(rawParsed?.events) ? rawParsed.events : [];
      parsed.events = rawEvents.map(normalizeExtractedEvent);
      if (input.detectPlaces && Array.isArray(rawParsed?.places)) {
        parsed.places = rawParsed.places
          .map(normalizeExtractedPlace)
          .filter((p: ExtractedPlace | null): p is ExtractedPlace => !!p && p.family_suitable);
      }
    } catch {
      // fall through with empty events
    }
  }

  // Belt-and-braces location filter: drop anything that explicitly mentions
  // a city outside the allowed list. The AI should already have skipped
  // these via the LOCATION FILTER prompt rule, but a regex safety net catches
  // anything it slipped past.
  if (input.locationFilter) {
    const allowed = new Set(
      [input.locationFilter.city, ...(input.locationFilter.nearbyAreas ?? [])]
        .map((s) => s.toLowerCase()),
    );
    // UK cities that have active live-music scenes — most likely to appear
    // on multi-city promoter tours. Add to this list if more slip through.
    const candidates = [
      "glasgow", "edinburgh", "aberdeen", "stirling", "perth", "inverness",
      "london", "manchester", "liverpool", "birmingham", "leeds", "newcastle",
      "sheffield", "bristol", "belfast", "cardiff", "nottingham", "leicester",
      "falkirk", "st andrews", "forfar", "arbroath", "kirriemuir",
    ];
    const blocked = candidates.filter((c) => !allowed.has(c));
    parsed.events = parsed.events.filter((e) => {
      const text = `${e.venue_hint ?? ""} ${e.description ?? ""} ${e.title ?? ""}`.toLowerCase();
      // Word-boundary check so "perthshire" doesn't trigger "perth" if you
      // ever expand the allowed list. Also avoids hitting "London Road" etc.
      for (const city of blocked) {
        const re = new RegExp(`\\b${city.replace(/\s+/g, "\\s+")}\\b`, "i");
        if (re.test(text)) return false;
      }
      return true;
    });
  }

  return { events: parsed.events, places: parsed.places, raw: json };
}

// ============================================================
// Festival lineup extraction
//
// Given a festival's poster(s), pull every venue × artist × time slot
// out as structured rows. Differs from extractEvents in that:
//   - The result is FLAT (no recurring patterns, no genre detection —
//     just the raw lineup slots)
//   - Claude is told the festival's participating venues upfront, so
//     it can match venue names accurately even when the poster uses a
//     shortened form ("Doghouse" vs "Doghouse Bar Dundee")
//   - Day is a YYYY-MM-DD string within the festival window, not a
//     full timestamp — the caller converts to a full UTC instant by
//     combining day + startTime in Europe/London tz.
// ============================================================

export type LineupExtractionInput = {
  festivalName: string;
  // Used so Claude can map "Friday" / "Sat" labels to a concrete date.
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  // The festival's linked venues. Claude is told to match every slot's
  // venue to one of these names; anything that doesn't match comes
  // back prefixed "?: " so the admin sees it as unmatched.
  venueOptions: { id: string; name: string }[];
  // Poster images, pre-uploaded to Supabase Storage so the server can
  // fetch them with a normal User-Agent.
  imageUrls: string[];
};

export type ExtractedLineupSlot = {
  // Raw venue name Claude extracted. If it matched one of the supplied
  // venues, this string equals one of venueOptions[i].name. If not, it's
  // prefixed "?: " followed by the literal text on the poster.
  venue: string;
  artist: string;
  // YYYY-MM-DD within the festival window.
  day: string;
  // 24-hour wall clock, Europe/London.
  startTime: string; // "HH:mm"
  // null when only a start time is shown on the poster — the caller
  // can leave it null and let the existing effectiveEndTime() logic
  // close the event at the venue's closing time.
  endTime: string | null;
  // Sub-stage within a venue (e.g. "Main Stage" vs "Backroom"). Most
  // multi-venue festivals don't bother; null when unspecified.
  stage: string | null;
};

export type LineupExtractionResult = {
  slots: ExtractedLineupSlot[];
  raw: unknown;
};

function buildLineupSystemPrompt(input: LineupExtractionInput): string {
  // Hint list — venues we already know about, used to nudge Claude
  // toward consistent naming when the poster shows a shortened form
  // ("Doghouse" vs "Doghouse Bar Dundee"). NOT a hard constraint
  // anymore — Claude is free to extract venue names it doesn't
  // recognise, and the server will create them on the fly.
  const venueHints = input.venueOptions.length > 0
    ? `\nKNOWN VENUE NAMES (use the exact spelling shown when the poster matches one of these — but feel free to extract names not on this list, the system will create new venues for them):\n${input.venueOptions.map((v) => `  - ${v.name}`).join("\n")}`
    : "";

  return `You extract a multi-venue music festival lineup from poster images.

FESTIVAL: ${input.festivalName}
DATES: ${input.startDate} to ${input.endDate}${venueHints}

Return ONLY this JSON, no prose, no markdown fence:
{
  "slots": [
    {
      "venue": "Doghouse Bar",
      "artist": "Kyle Falconer",
      "day": "${input.startDate}",
      "startTime": "20:00",
      "endTime": "21:30",
      "stage": null
    }
  ]
}

RULES
- venue: the literal venue name as it appears on the poster. Preserve the proper-case spelling. When a poster uses a shortened form that matches one of the KNOWN VENUE NAMES above, prefer the full known name.
- artist: the performer / band / DJ / act name. Skip sponsors, hosts not actually performing, and venue names mistaken for acts.
- day: YYYY-MM-DD date string that falls between ${input.startDate} and ${input.endDate}. If the poster only says "FRIDAY" / "SAT" / "DAY 1", compute the date from the festival dates above.
- startTime: 24-hour HH:mm, Europe/London local time.
- endTime: 24-hour HH:mm OR null when the poster shows only a start time.
- stage: room / sub-stage name within a venue (e.g. "Main Stage", "Acoustic Room"). null when there's only one stage at that venue, which is the usual case for city-wide multi-venue festivals.
- One slot per act. If a band plays two sets the same day, emit two slots.
- Skip unclear / illegible entries. Better to miss than to invent.
- Return { "slots": [] } if you can see nothing extractable.`;
}

/**
 * Pull every venue × artist × time slot from a festival's poster(s).
 *
 * Designed for city-wide multi-venue festivals (Dundee Music Festival,
 * Brighton's Great Escape, etc.) where a single programme image lists
 * dozens of acts across multiple venues — and entering them one-by-one
 * via Quick Import would take an hour.
 *
 * Claude is told the festival's participating venues upfront so it can
 * fuzzy-match poster text ("Doghouse" → "Doghouse Bar Dundee") and only
 * emit slots that already exist in our DB. Anything it can't match
 * comes back prefixed "?: " so the admin can manually pick the venue
 * in the review UI.
 */
export async function extractFestivalLineup(
  input: LineupExtractionInput,
): Promise<LineupExtractionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY env var missing.");
  if (input.imageUrls.length === 0) {
    return { slots: [], raw: { skipped: "no images" } };
  }

  const content: any[] = [];
  const imageWarnings: string[] = [];
  for (const url of input.imageUrls) {
    if (!url) continue;
    try {
      const { media_type, data } = await fetchImageAsBase64(url);
      content.push({
        type: "image",
        source: { type: "base64", media_type, data },
      });
    } catch (e: any) {
      imageWarnings.push(`${url}: ${e?.message ?? "fetch failed"}`);
    }
  }
  if (imageWarnings.length > 0) {
    content.push({
      type: "text",
      text: `(Note: ${imageWarnings.length} image${imageWarnings.length === 1 ? " was" : "s were"} unreachable and skipped: ${imageWarnings.join("; ")})`,
    });
  }
  content.push({
    type: "text",
    text: "Extract the festival lineup from the image(s) above. Return ONLY a JSON object matching the schema in the system prompt.",
  });

  // Generous max_tokens — a city-wide festival can easily have 80-150
  // slots and we don't want to truncate mid-JSON.
  const body = {
    model: MODEL,
    max_tokens: 8192,
    system: buildLineupSystemPrompt(input),
    messages: [{ role: "user", content }],
  };

  // Lean on the same retry-with-backoff that extractEvents uses for
  // 429s — Anthropic's tier limits can bite when several admins extract
  // simultaneously, and a single retry usually clears it.
  const res = await callAnthropicWithRetry(apiKey, body);
  const json: any = await res.json();
  const textBlock = (json.content ?? []).find((b: any) => b.type === "text");
  const responseText: string = textBlock?.text ?? "";
  const m = responseText.match(/\{[\s\S]*\}/);
  if (!m) return { slots: [], raw: json };
  let parsed: any;
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return { slots: [], raw: json };
  }
  if (!Array.isArray(parsed.slots)) return { slots: [], raw: json };

  // Schema scrub — drop any slot that's missing required fields rather
  // than letting an Anthropic hallucination crash the publish step.
  const slots: ExtractedLineupSlot[] = parsed.slots
    .filter((s: any) =>
      typeof s?.venue === "string" && s.venue.trim().length > 0 &&
      typeof s?.artist === "string" && s.artist.trim().length > 0 &&
      typeof s?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.day) &&
      typeof s?.startTime === "string" && /^\d{2}:\d{2}$/.test(s.startTime)
    )
    .map((s: any) => ({
      venue: s.venue.trim(),
      artist: s.artist.trim(),
      day: s.day,
      startTime: s.startTime,
      endTime:
        typeof s.endTime === "string" && /^\d{2}:\d{2}$/.test(s.endTime)
          ? s.endTime
          : null,
      stage:
        typeof s.stage === "string" && s.stage.trim().length > 0
          ? s.stage.trim()
          : null,
    }));

  return { slots, raw: json };
}
