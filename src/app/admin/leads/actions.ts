"use server";

// Lead-gen tool for the ad business. Pulls a list of local businesses from
// Apify Google Maps for a given city + category, then scrapes each one's
// website for an email address. Output is a CSV-ready array of leads.
//
// Cost model: Apify is ~$0.002 per result. 8 categories × ~30 results × 2
// cities ≈ 480 results ≈ $0.96 per full sweep. We cap per-category and
// per-run so a runaway can't burn money.
//
// Email extraction: simple regex over the homepage + /contact page HTML.
// Misses business that hide their email behind contact forms or images,
// which is fine — we just skip them and the user can chase manually.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { LEAD_CATEGORIES, type LeadCategorySlug } from "./categories";

// We deliberately do NOT re-export LeadCategorySlug from this "use server"
// file — Next.js's server-action compiler ends up treating type re-exports
// as runtime references and crashes with "X is not defined" at module load.
// Clients should import the type straight from ./categories instead.

const APIFY_API = "https://api.apify.com/v2";
const APIFY_GMAPS_ACTOR = "compass~crawler-google-places";

export type Lead = {
  name: string;
  category: string;
  city: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  facebook: string | null;
  email: string | null;
  // Where the email came from, for our own debugging — apify | website | facebook | null
  email_source: "apify" | "website" | "facebook" | null;
};

// Per-category cap. Aggressive to keep cost predictable.
const MAX_RESULTS_PER_SEARCH = 25;

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return null;
  return true;
}

// ----------------------------------------------------------------------
// Apify Google Maps — search one query, return raw places.
// ----------------------------------------------------------------------

type ApifyPlace = {
  title?: string;
  address?: string;
  phone?: string;
  website?: string;
  emails?: string[];
  // Apify's google-places actor surfaces social links under several
  // different keys depending on version. We grab whichever shows up.
  facebookUrl?: string;
  facebook?: string;
  socialMediaLinks?: { facebook?: string };
};

async function runApifyGmaps(
  query: string,
  maxResults: number,
  token: string,
): Promise<{ items: ApifyPlace[]; cost: number; error?: string }> {
  const startUrl = `${APIFY_API}/acts/${APIFY_GMAPS_ACTOR}/runs?token=${encodeURIComponent(token)}`;
  const input = {
    searchStringsArray: [query],
    maxCrawledPlacesPerSearch: maxResults,
    language: "en",
    countryCode: "gb",
    skipClosedPlaces: true,
    // Ask Apify to also pull emails from the place's website where it can.
    // Saves a chunk of our own scrape work.
    scrapeContacts: true,
  };

  let runId: string;
  let datasetId: string;
  try {
    const res = await fetch(startUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const t = await res.text();
      return { items: [], cost: 0, error: `Apify start ${res.status}: ${t.slice(0, 300)}` };
    }
    const json = await res.json();
    runId = json?.data?.id;
    datasetId = json?.data?.defaultDatasetId;
    if (!runId || !datasetId) return { items: [], cost: 0, error: "Apify start: no run id" };
  } catch (e: any) {
    return { items: [], cost: 0, error: `Apify start exception: ${e?.message ?? e}` };
  }

  // Poll for completion. 60s hard cap.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const r = await fetch(
      `${APIFY_API}/actor-runs/${runId}?token=${encodeURIComponent(token)}`,
    );
    if (!r.ok) continue;
    const j = await r.json();
    const status = j?.data?.status;
    if (status === "SUCCEEDED") break;
    if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      return { items: [], cost: 0, error: `Apify run ${status}` };
    }
  }

  // Pull dataset.
  const dsRes = await fetch(
    `${APIFY_API}/datasets/${datasetId}/items?clean=true&token=${encodeURIComponent(token)}`,
  );
  if (!dsRes.ok) return { items: [], cost: 0, error: `Apify dataset ${dsRes.status}` };
  const items = (await dsRes.json()) as ApifyPlace[];
  const cost = items.length * 0.002;
  return { items, cost };
}

// ----------------------------------------------------------------------
// Email scraping fallback — fetch homepage + /contact, regex out emails.
// Apify already does this with scrapeContacts: true, but we re-try on
// places where Apify didn't find one.
// ----------------------------------------------------------------------

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Skip placeholder / framework noise that often appears in HTML
// (e.g. "example@example.com" inside CSS, or Wix support emails).
const EMAIL_BLOCKLIST = [
  "example.com",
  "yourdomain.com",
  "sentry.io",
  "wixpress.com",
  "wix.com",
  "godaddy.com",
  "squarespace.com",
  "shopify.com",
  "domain.com",
  "@2x.png",
];

function pickBestEmail(candidates: string[], website: string | null): string | null {
  const cleaned = candidates
    .map((e) => e.toLowerCase().trim())
    .filter((e) => !EMAIL_BLOCKLIST.some((b) => e.includes(b)));
  if (cleaned.length === 0) return null;
  // Prefer an email whose domain matches the business's own website.
  if (website) {
    try {
      const host = new URL(website).hostname.replace(/^www\./, "");
      const matching = cleaned.find((e) => e.endsWith("@" + host));
      if (matching) return matching;
    } catch { /* not a URL, ignore */ }
  }
  // Otherwise, prefer info@ / hello@ / contact@ over generic
  const preferred = cleaned.find((e) =>
    /^(info|hello|contact|enquiries|bookings|reception|admin)@/.test(e),
  );
  return preferred ?? cleaned[0];
}

// Try to extract an email from a Facebook page. FB's regular page HTML
// is JS-rendered and won't include the email server-side, BUT the legacy
// mobile site (m.facebook.com) still serves rendered HTML with the
// About-section contact info inline. We try that first.
//
// Hit-or-miss — FB constantly tweaks what gets returned. Best-effort only.
async function scrapeEmailFromFacebookPage(fbUrl: string): Promise<string | null> {
  // Normalise: take just the path, convert to m.facebook.com
  let path: string;
  try {
    const u = new URL(fbUrl);
    if (!/facebook\.com$/i.test(u.hostname) && !/facebook\.com$/i.test(u.hostname.replace(/^www\./, ""))) {
      return null;
    }
    path = u.pathname.replace(/\/$/, "");
  } catch {
    return null;
  }

  const tryUrls = [
    `https://m.facebook.com${path}/about`,
    `https://m.facebook.com${path}`,
  ];
  const found: string[] = [];
  for (const url of tryUrls) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          "Accept-Language": "en-GB,en;q=0.9",
        },
        redirect: "follow",
      });
      if (!res.ok) continue;
      const text = await res.text();
      const matches = text.match(EMAIL_RE) ?? [];
      for (const m of matches) found.push(m);
      if (found.length > 0) break;
    } catch {
      // Login wall, blocked, timeout — skip.
    }
  }
  // FB itself appears in lots of HTML — filter out fb's own emails.
  const cleaned = found.filter(
    (e) => !/@facebook\.com$|@fb\.com$|noreply/i.test(e),
  );
  return pickBestEmail(cleaned, null);
}

async function scrapeEmailFromWebsite(website: string): Promise<string | null> {
  const tryPaths = ["/", "/contact", "/contact-us", "/about"];
  const found: string[] = [];
  for (const path of tryPaths) {
    try {
      const url = new URL(path, website).toString();
      const res = await fetch(url, {
        signal: AbortSignal.timeout(6000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; TheBuzz-LeadsBot/1.0; +https://thebuzzguide.co.uk)",
        },
        redirect: "follow",
      });
      if (!res.ok) continue;
      const text = await res.text();
      const matches = text.match(EMAIL_RE) ?? [];
      for (const m of matches) found.push(m);
      if (found.length > 0) break; // got at least one — stop here, don't waste req
    } catch {
      // Connection refused, DNS fail, timeout — skip this path.
    }
  }
  return pickBestEmail(found, website);
}

// ----------------------------------------------------------------------
// Main entry: run one category for one city/town list.
// ----------------------------------------------------------------------

export type RunLeadsResult =
  | { error: string }
  | {
      ok: true;
      leads: Lead[];
      apifyCost: number;
      timings: { totalMs: number; scrapedSites: number };
    };

export async function runLeadsForCategory(
  citySlug: string,
  categorySlug: LeadCategorySlug,
): Promise<RunLeadsResult> {
  // Top-level try/catch — any unhandled exception (bad URL, JSON parse,
  // fetch dying, etc) gets turned into a friendly { error } string for the
  // client. Without this, a single thrown exception 500s the entire action
  // and the client sees only "Internal Server Error" with no detail.
  try {
    return await runLeadsForCategoryInner(citySlug, categorySlug);
  } catch (e: any) {
    console.error("[leads] uncaught error", e);
    return { error: `Unexpected error: ${e?.message ?? String(e).slice(0, 200)}` };
  }
}

async function runLeadsForCategoryInner(
  citySlug: string,
  categorySlug: LeadCategorySlug,
): Promise<RunLeadsResult> {
  if (!(await requireAdmin())) return { error: "Admins only." };

  const token = process.env.APIFY_TOKEN;
  if (!token) return { error: "APIFY_TOKEN env var isn't set on the server." };

  const sb = createServiceClient();
  const { data: city } = await sb
    .from("cities")
    .select("id, name, slug, nearby_areas")
    .eq("slug", citySlug)
    .maybeSingle();
  if (!city) return { error: `City "${citySlug}" not found.` };

  const cat = LEAD_CATEGORIES.find((c) => c.slug === categorySlug);
  if (!cat) return { error: `Category "${categorySlug}" not found.` };

  // Build the location modifier. For Dundee we use just "Dundee, Scotland".
  // For Angus we use the city name + sample of nearby areas to widen the
  // catchment (otherwise GMaps misses Forfar, Arbroath, etc).
  const locationStrings: string[] = [];
  if (city.slug === "angus") {
    // Angus is dispersed across multiple towns; query the main 3 for coverage.
    locationStrings.push("Arbroath, Angus, Scotland");
    locationStrings.push("Forfar, Angus, Scotland");
    locationStrings.push("Montrose, Angus, Scotland");
  } else {
    locationStrings.push(`${city.name}, Scotland`);
  }

  const start = Date.now();
  let totalCost = 0;
  let scrapedCount = 0;
  const seenByName = new Set<string>();
  const leads: Lead[] = [];

  // Build the full grid of (search × location) queries.
  const queries: string[] = [];
  for (const search of cat.searches) {
    for (const loc of locationStrings) {
      queries.push(`${search} in ${loc}`);
    }
  }

  // Run them in PARALLEL. Apify happily handles concurrent runs (each
  // gets its own runId). Drops total runtime from "sum of all queries"
  // to "longest single query".
  //
  // We use allSettled so one failing query doesn't poison the rest — if
  // Apify rejects one search but the other 5 worked, we still want those
  // 5 sets of results back instead of bailing the whole action.
  const settled = await Promise.allSettled(
    queries.map((q) => runApifyGmaps(q, MAX_RESULTS_PER_SEARCH, token)),
  );
  const apifyResults = settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    return { items: [], cost: 0, error: `Promise rejected: ${s.reason?.message ?? s.reason}` };
  });

  for (let i = 0; i < apifyResults.length; i++) {
    const r = apifyResults[i];
    totalCost += r.cost;
    if (r.error) {
      console.error("[leads] apify error", queries[i], r.error);
      continue;
    }
    for (const place of r.items) {
      const name = (place.title ?? "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seenByName.has(key)) continue;
      seenByName.add(key);
      const apifyEmail = (place.emails ?? [])[0] ?? null;
      const fb =
        place.facebookUrl ??
        place.facebook ??
        place.socialMediaLinks?.facebook ??
        null;
      leads.push({
        name,
        category: cat.label,
        city: city.name,
        address: place.address ?? null,
        phone: place.phone ?? null,
        website: place.website ?? null,
        facebook: fb,
        email: apifyEmail,
        email_source: apifyEmail ? "apify" : null,
      });
    }
  }

  // Pass 1: businesses without email but with a website — scrape homepage
  // + /contact. Parallel-fan-out is safe (different hosts).
  const needEmailWeb = leads.filter((l) => !l.email && l.website);
  await Promise.allSettled(
    needEmailWeb.map(async (lead) => {
      const e = await scrapeEmailFromWebsite(lead.website!);
      scrapedCount++;
      if (e) {
        lead.email = e;
        lead.email_source = "website";
      }
    }),
  );

  // Pass 2: still no email AND we have a Facebook page — try FB. This is
  // the "no website at all" case. Hit-or-miss because FB blocks bots, but
  // free to attempt.
  const needEmailFb = leads.filter((l) => !l.email && l.facebook);
  await Promise.allSettled(
    needEmailFb.map(async (lead) => {
      const e = await scrapeEmailFromFacebookPage(lead.facebook!);
      scrapedCount++;
      if (e) {
        lead.email = e;
        lead.email_source = "facebook";
      }
    }),
  );

  return {
    ok: true,
    leads,
    apifyCost: totalCost,
    timings: {
      totalMs: Date.now() - start,
      scrapedSites: scrapedCount,
    },
  };
}

// CSV export — kept server-side so the admin doesn't see a "your browser
// blocked this download" dialog (CSV strings can be long).
export async function leadsToCsv(leads: Lead[]): Promise<string> {
  const header = [
    "Name", "Category", "City", "Address", "Phone", "Website", "Facebook", "Email", "Email source",
  ];
  const rows = leads.map((l) => [
    l.name,
    l.category,
    l.city,
    l.address ?? "",
    l.phone ?? "",
    l.website ?? "",
    l.facebook ?? "",
    l.email ?? "",
    l.email_source ?? "",
  ]);
  // Excel-safe quoting.
  function q(s: string) {
    const safe = String(s).replace(/"/g, '""');
    return `"${safe}"`;
  }
  return [header, ...rows].map((r) => r.map(q).join(",")).join("\r\n");
}
