// AI event extraction — pure helper. No DB, no auth, no side effects.
// Takes a venue + a "post" (text + image URLs + posted-at timestamp) and
// returns the structured events Claude pulls out of it.
//
// Used by the manual upload route and (later) the FB / website scrapers.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_EXTRACTION_MODEL ?? "claude-sonnet-4-5-20250929";

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
  availableGenres?: { slug: string; name: string }[];
  // Optional geographic restriction. When set, the AI is told to skip any
  // event whose venue is not in `city` or one of `nearbyAreas`. Used by the
  // multi-venue site importer where the source page may list events across
  // multiple cities. Leave undefined for the FB / venue-website scrapers
  // where the venue is already pinned.
  locationFilter?: {
    city: string;
    nearbyAreas?: string[];
  };
};

export type ExtractedEvent = {
  title: string;
  starts_at: string;       // ISO Europe/London
  ends_at: string | null;
  recurring: { pattern: string; until: string | null } | null;
  type: "live_music" | "sports_screening" | "karaoke" | "quiz" | "dj_set" | "other";
  genres: string[];        // slugs from availableGenres
  artists: string[];       // band / DJ / act names mentioned for this event
  description: string;
  confidence: number;
  evidence: string;
  // 0-based index into the input images that is the gig POSTER / FLYER for
  // this specific event. null if the post had no clear poster (e.g. plain
  // text caption, or just a generic venue photo). Used to persist the
  // correct image to our storage bucket per event.
  poster_image_index: number | null;
  // Venue name detected on the poster, if any. Used by the admin Quick
  // Import flow when no specific venue is pre-selected. null if the
  // venue isn't visible on the poster.
  venue_hint: string | null;
  // Price / cover charge as written on the poster ("£10", "Free", "£8 / £6 conc"). null if not stated.
  cover_charge: string | null;
  // Direct ticket / booking URL if visible on the poster or the page text. null if absent.
  ticket_url: string | null;
};

export type ExtractionResult = {
  events: ExtractedEvent[];
  raw: any;
};

function buildSystemPrompt(
  venueName: string,
  postedIso: string,
  availableGenres: { slug: string; name: string }[],
  locationFilter?: ExtractionInput["locationFilter"],
): string {
  const postedHuman = new Date(postedIso).toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
  const genreLine =
    availableGenres.length > 0
      ? availableGenres.map((g) => `${g.slug} (${g.name})`).join(", ")
      : "(none configured — leave genres as [])";
  return `You extract events from a Dundee pub/venue's social-media post or website for The Buzz Guide, a live-music & events directory.

VENUE: ${venueName}
POSTED: ${postedHuman} (${postedIso}, Europe/London)

AVAILABLE GENRES (use these slugs ONLY): ${genreLine}

Return ONLY a JSON object of this shape:
{
  "events": [
    {
      "title": "string — short, plain, no emojis or marketing fluff",
      "starts_at": "ISO 8601 datetime in Europe/London (e.g. 2026-05-05T20:00:00+01:00)",
      "ends_at": "ISO 8601 datetime or null",
      "recurring": null OR { "pattern": "weekly|daily|every_sunday|...", "until": "YYYY-MM-DD or null" },
      "type": "live_music | sports_screening | karaoke | quiz | dj_set | other",
      "genres": ["slug1", "slug2"],
      "artists": ["Band Name", "DJ Name"],
      "description": "one neutral sentence",
      "confidence": 0.0-1.0,
      "evidence": "brief quote of where you got the date/time from (poster text, caption, or page text)",
      "poster_image_index": 0,
      "venue_hint": "string or null",
      "cover_charge": "string or null",
      "ticket_url": "string or null"
    }
  ]
}

RESOLUTION RULES
- Resolve relative dates ("tonight", "this Sunday", "Sunday 10th May") using POSTED above.
- A "this week" recurring post with no specific times → ONE event with recurring set, until null.
- If a date has no year, assume the next occurrence from POSTED.

TIMES (very important — extract end_time whenever the poster gives one)
- Single times: "Kick-off 8pm" / "From 8pm" / "Doors 7:30pm" → starts_at = 20:00 (or 19:30) and ends_at = null.
- TIME RANGES on the poster MUST populate BOTH starts_at and ends_at — don't drop the end side:
  * "3pm - 4pm"             → starts_at 15:00, ends_at 16:00
  * "3pm – 4pm"             → starts_at 15:00, ends_at 16:00 (en-dash, em-dash, hyphen, "to" or "until" all count as range markers)
  * "12 noon - 1:50pm"      → starts_at 12:00, ends_at 13:50
  * "10:30am – 11:30am"     → starts_at 10:30, ends_at 11:30
  * "8pm till late"         → starts_at 20:00, ends_at null (no concrete end)
  * "8pm-1am" (crosses midnight) → starts_at 20:00, ends_at = next day at 01:00
- Multi-slot events on the same poster: each slot gets its own event row with its own starts_at + ends_at.
- "Doors 7pm, show 8pm" → starts_at 20:00 (show time), ends_at null. Doors-only times aren't the event start.

SPORTS SCREENING AGGREGATION (very important)
- A sports bar fixtures list often shows many matches across multiple days
  (e.g. "Monday 11th: Match A 18:00, Match B 19:45 — Tuesday 12th: Match C 14:00, Match D 19:45").
- Return ONE event per day per venue when the post lists 2+ sports screenings
  on the same day — NOT one event per match. The visitor sees a single card
  on the city page instead of 8 redundant rows.
- For these aggregated days:
  * title: "Live sports — N matches" (use the actual count) — e.g. "Live sports — 5 matches"
  * starts_at: the earliest kick-off that day
  * ends_at: the latest match's expected end (add ~2 hours to its kick-off if not stated)
  * type: "sports_screening"
  * description: chronological list, one match per line, format "HH:MM — Event Name"
    (e.g. "18:00 — Internazionali BNL d'Italia\\n19:45 — Napoli v Bologna\\n20:00 — Millwall v Hull City")
  * Keep any emoji prefixes from the source (⚽️, 🎾, ⛳️, 🏉, 🏏) — they help fans scan the list.
- If there's only ONE sports screening on a given day, return it as a normal
  single-match event with its own title (e.g. "Manchester City v Crystal Palace").
- Mixed days: one aggregated event per multi-match day, plus single events for single-match days.
- This rule ONLY applies to type="sports_screening". Live music / quiz / karaoke
  / DJ events always remain as one row each.

GENRE RULES
- Pick 1–3 matching slugs from AVAILABLE GENRES for each event. Do NOT invent slugs that aren't in that list.
- For live music / DJ events: pick the music genre(s). Cover band → match the songs they cover. Tribute act → the original artist's genre. Ceilidh → folk / traditional.
- For sports screenings: pick "sports" if that slug exists.
- For karaoke: pick "karaoke" if that slug exists.
- For pub quizzes: pick "quiz" if that slug exists.
- For DJ nights with unspecified genre: pick "electronic" if it fits.
- If you genuinely can't categorise the event with any of the available slugs, fall back to ["other"] (only if "other" exists in AVAILABLE GENRES). Never invent a new slug, never leave the array empty unless "other" isn't in the list either.

ARTIST RULES
- For live music / DJ events: pull every band, DJ, performer, or act named on the poster / in the caption into "artists".
- Include support acts and "+ guests" as separate entries when named. If the poster says "headliner: BAND, support: SUPPORT", return ["BAND", "SUPPORT"].
- Tribute acts: keep the tribute name as-is ("ABBA Mania", "Oasish") — do NOT replace with the original artist.
- Cover bands: use their actual band name, not the song titles they cover.
- DJ events: include all DJ names listed.
- Karaoke: if a karaoke host / MC / KJ is named (e.g. "Karaoke with DJ Buzzkill", "Hosted by Big Mic Mike"), include their name. If it's just "karaoke night" with no host named, leave [].
- Quiz / sports screenings: leave artists as [].
- If you genuinely can't tell, leave [] rather than guessing. Don't invent names.

DEDUPLICATION (very important)
- If the SAME event appears multiple times in the input (e.g. "Karaoke nightly" mentioned on the homepage AND the /events page AND the menu), return it ONCE only. Treat the input as a single source of truth even when text and images repeat.
- A recurring weekly/nightly event = ONE event row with recurring set, NOT one row per occurrence.
- Same event title + same date/time = same event. Don't return both.

DO NOT EXTRACT
- Thank-you posts, recap of past events, generic "we're open" posts.
- Food/drink specials with no time-bound performance or screening.
- General venue vibe / staff news / photos of past nights.

CONFIDENCE GUIDE
- 0.9+ : explicit date AND time AND clear event title
- 0.7–0.9 : two of the three explicit, one inferred
- 0.5–0.7 : significant inference required
- < 0.5 : do not return — leave it out

VENUE HINT
- Set "venue_hint" to the venue name printed on the poster, if any (e.g. "The Anchor Bar", "Rewind", "Beat Generator"). null if the poster doesn't show a venue.
- Even though VENUE is given above as context, an admin may pass that in as a placeholder. Read the poster independently and report what name (if any) you actually see.

${locationFilter ? `LOCATION FILTER (HARD RULE — skip non-matching events entirely)
- ONLY return events at venues in ${locationFilter.city}${(locationFilter.nearbyAreas && locationFilter.nearbyAreas.length > 0) ? ` or ${locationFilter.nearbyAreas.join(", ")}` : ""}.
- If the poster / page text mentions any other UK city (e.g. Glasgow, Edinburgh, Aberdeen, Stirling, Perth, Inverness, London, Manchester, Liverpool, Birmingham, Leeds, Newcastle, Belfast, Cardiff, Bristol, Falkirk, St Andrews, Forfar, Arbroath, Kirriemuir, Carnoustie, Monifieth) — and that city ISN'T in the allowed list above — DO NOT return that event. Drop it silently.
- Touring posters: a comedy / band tour might list multiple cities. Only return the ${locationFilter.city} date(s); skip every other city.
- If you genuinely can't tell which city an event is in, DO return it (better to surface for human review than silently drop). The admin can always reject it after.
- This filter applies BEFORE all other rules. An event that's perfect in every other way still gets dropped if it's outside the allowed cities.` : ""}

PRICE / COVER CHARGE
- Set "cover_charge" to the ticket price exactly as written ("£10", "£8 / £6 conc", "£12 adv / £15 door", "Free entry"). null if the poster / page doesn't state a price.
- Don't normalise — keep the exact wording.
- "Donations welcome" / "Pay what you want" → use that phrase.

TICKET URL
- Set "ticket_url" to a direct link to buy / book tickets, ONLY if a clear booking URL is visible in the page text or on the poster (eventbrite, skiddle, ticketweb, link.dice.fm, the venue's own /tickets page, etc.).
- Bare event-detail URLs (the page being scraped, generic homepages) do NOT count. null in that case.

POSTER IMAGE
- Set "poster_image_index" to the 0-based index of which input image is the gig POSTER / FLYER for this specific event.
- A poster is the artwork that visually advertises this event — usually shows the gig title, date/time, performer name, sometimes a photo of the act.
- A generic venue photo, food shot, staff selfie, or repeated venue logo is NOT a poster — return null in that case.
- If multiple events share the same poster (e.g. a "what's on this week" graphic), use the same index for each event.
- If no images were provided, or none of them is clearly a poster, set poster_image_index to null.
- The index refers to the order images appear in the input (first image = 0, second = 1, etc.).

If nothing event-like, return { "events": [] }.`;
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
    system: buildSystemPrompt(input.venueName, input.postedAt, input.availableGenres ?? [], input.locationFilter),
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
  let parsed: { events: ExtractedEvent[] } = { events: [] };
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed.events)) parsed.events = [];
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

  return { events: parsed.events, raw: json };
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
