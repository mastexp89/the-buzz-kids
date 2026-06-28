"use server";

// Sponsor outreach lead generator.
//
// Search workflow:
//   1. Admin picks business type(s) + a city.
//   2. We hit Brave Search ("hairdresser Dundee site:facebook.com" etc.)
//      for each business type, gather Facebook page URLs + titles +
//      descriptions, dedupe by URL.
//   3. We upsert into sponsor_outreach_leads — re-running the same search
//      a week later DOESN'T duplicate rows, it just touches updated_at on
//      anything we've already seen. New finds get inserted.
//
// Why Brave: we already pay for it (artist photo finder). UK-biased
// results via country=gb. site:facebook.com narrows to the Page URLs
// we actually want to DM. Free 2k/mo on the basic plan = ~333 city-type
// pairs/month, plenty.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return null;
  return { userId: user.id };
}

// ---------- Types ----------

export type LeadCandidate = {
  name: string;
  fbUrl: string;
  description: string | null;
  // Did this URL already exist in our DB? UI uses this to grey-out
  // "already saved" rows so the admin doesn't waste time on dupes.
  alreadySaved: boolean;
};

export type FindLeadsResult =
  | { ok: true; candidates: LeadCandidate[]; queriesRun: number; cityName: string }
  | { error: string };

export type SaveLeadsResult =
  | { ok: true; inserted: number; touched: number }
  | { error: string };

// (BUSINESS_TYPE_PRESETS lives in ./constants.ts — files marked
// "use server" can only export async functions, so re-exporting a
// const array from here fails the production build with
// "Failed to collect page data".)

// ---------- Brave search ----------

type BraveHit = { url: string; title: string; description: string };

async function searchBraveLeads(query: string, apiKey: string): Promise<{ hits: BraveHit[]; error?: string }> {
  // Same UK-biasing as the artist photo finder — country=gb stops Brave
  // showing US results for ambiguous names ("Dundee" exists in Illinois,
  // Florida, Michigan, etc.).
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=20&country=gb&search_lang=en&ui_lang=en-GB`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { hits: [], error: `${res.status} from Brave Search` };
    }
    const json = await res.json();
    const results: any[] = json?.web?.results ?? [];
    const hits: BraveHit[] = [];
    for (const r of results) {
      const url = typeof r?.url === "string" ? r.url : null;
      if (!url) continue;
      const cleaned = cleanFacebookPageUrl(url);
      if (!cleaned) continue;
      hits.push({
        url: cleaned,
        title: extractBusinessName(r?.title ?? "", r?.url ?? cleaned),
        description: typeof r?.description === "string" ? stripHtml(r.description) : "",
      });
    }
    return { hits };
  } catch (e: any) {
    return { hits: [], error: e?.message ?? "Brave fetch failed" };
  }
}

// Brave returns titles like "The Cutting Room | Facebook" or
// "Joe's Barbers - Posts | Facebook". Strip the Facebook suffix +
// noise so we save a clean business name.
function extractBusinessName(rawTitle: string, fallbackUrl: string): string {
  let t = rawTitle.trim();
  // Strip trailing "| Facebook" or "- Facebook"
  t = t.replace(/\s*[|\-]\s*Facebook\s*$/i, "");
  // Strip trailing " - Posts" / " - Home" / " - Reviews" / " - About"
  t = t.replace(/\s*-\s*(Posts|Home|Reviews|About|Photos|Videos)\s*$/i, "");
  // Trim quotes that Brave sometimes wraps the title in
  t = t.replace(/^["'""]+|["'""]+$/g, "").trim();
  if (t.length > 0) return t;
  // Fallback: derive from the URL path.
  try {
    const u = new URL(fallbackUrl);
    const seg = u.pathname.split("/").filter(Boolean)[0] ?? "";
    return decodeURIComponent(seg).replace(/[-_.]+/g, " ").trim() || "(unknown page)";
  } catch {
    return "(unknown page)";
  }
}

function stripHtml(s: string): string {
  // Brave wraps matched query terms in <strong>. We just want the text.
  return s.replace(/<[^>]+>/g, "").trim();
}

// FB system paths we never want as leads (login pages, watch, the
// "people" directory, etc.). Same idea as the artist-photo finder's
// JUNK_FB_PATH_RE — kept local to this file so the two tools don't
// silently drift apart.
const JUNK_FB_PATHS = new Set([
  "login",
  "logout",
  "watch",
  "marketplace",
  "events",
  "groups",
  "gaming",
  "help",
  "policies",
  "settings",
  "share",
  "search",
  "people",
  "pages",
  "places",
  "directory",
  "business",
  "ads",
  "reg",
  "recover",
]);

function cleanFacebookPageUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (!host.endsWith("facebook.com") && !host.endsWith("fb.com")) return null;
  // Normalise m./l./lm. subdomains to www so we dedupe properly.
  if (host.startsWith("m.") || host.startsWith("l.") || host.startsWith("lm.")) {
    u.hostname = "www." + host.split(".").slice(1).join(".");
  }
  u.search = "";
  u.hash = "";
  const path = u.pathname.replace(/\/+$/, "");
  u.pathname = path;
  if (path === "" || path === "/") return null;
  const firstSeg = path.replace(/^\//, "").split("/")[0]?.toLowerCase() ?? "";
  if (JUNK_FB_PATHS.has(firstSeg)) return null;
  // profile.php?id=... is a personal profile, not a Page — skip.
  if (/^profile\.php/i.test(firstSeg)) return null;
  return u.toString();
}

// ---------- Public actions ----------

/**
 * Run Brave searches across the provided business types for a city.
 * Returns deduplicated candidates with an `alreadySaved` flag so the
 * UI can show which ones are already in the DB.
 *
 * Does NOT write to the DB — admin reviews then bulk-saves via
 * saveSponsorLeads().
 */
export async function findSponsorLeads(opts: {
  businessTypes: string[];
  citySlug: string;
  cityName: string;
}): Promise<FindLeadsResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };

  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    return {
      error: "BRAVE_SEARCH_API_KEY is not set on this deploy. Add it in Vercel → Project Settings → Environment Variables and redeploy.",
    };
  }

  const types = (opts.businessTypes ?? [])
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length < 60);
  if (types.length === 0) return { error: "Pick at least one business type." };
  const cityName = opts.cityName?.trim();
  if (!cityName) return { error: "City is required." };

  // Dedupe across all queries — the same FB page can come back for
  // both "hairdresser" and "hair salon" searches.
  const byUrl = new Map<string, BraveHit>();
  let queriesRun = 0;
  for (const type of types) {
    // "Scotland" baked into every query so cities whose names collide
    // with overseas towns get the right hits. Brave's `country=gb`
    // param is only a ranking hint — a Canadian Angus or American
    // Dundee can still outrank the Scottish one based on page
    // signals. Adding the country term in the query string is a hard
    // disambiguator that works regardless of geo-bias strength.
    const query = `"${type}" ${cityName} Scotland site:facebook.com`;
    const { hits } = await searchBraveLeads(query, apiKey);
    queriesRun += 1;
    for (const h of hits) {
      // Keep the first hit per URL — later queries don't overwrite (the
      // first one usually has the best title/description for that page).
      if (!byUrl.has(h.url)) byUrl.set(h.url, h);
    }
    // Brave free tier = 1 request/sec. Stay polite.
    if (queriesRun < types.length) await sleep(1100);
  }

  if (byUrl.size === 0) {
    return { ok: true, candidates: [], queriesRun, cityName };
  }

  // Tag candidates that we've already saved before — UI greys them out.
  const sb = createServiceClient();
  const urls = Array.from(byUrl.keys());
  const { data: existing } = await sb
    .from("sponsor_outreach_leads")
    .select("fb_url")
    .in("fb_url", urls);
  const existingSet = new Set((existing ?? []).map((r: any) => r.fb_url as string));

  const candidates: LeadCandidate[] = Array.from(byUrl.values()).map((h) => ({
    name: h.title,
    fbUrl: h.url,
    description: h.description || null,
    alreadySaved: existingSet.has(h.url),
  }));

  return { ok: true, candidates, queriesRun, cityName };
}

/**
 * Bulk save selected candidates. Uses an upsert on fb_url so re-saving
 * the same page is a no-op (updated_at gets touched via the trigger).
 */
export async function saveSponsorLeads(opts: {
  leads: Array<{ name: string; fbUrl: string; description?: string | null }>;
  businessType: string | null;
  citySlug: string | null;
}): Promise<SaveLeadsResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };

  if (!opts.leads || opts.leads.length === 0) {
    return { error: "Nothing selected to save." };
  }

  const sb = createServiceClient();
  const urls = opts.leads.map((l) => l.fbUrl);
  const { data: prior } = await sb
    .from("sponsor_outreach_leads")
    .select("fb_url")
    .in("fb_url", urls);
  const priorSet = new Set((prior ?? []).map((r: any) => r.fb_url as string));

  const rows = opts.leads.map((l) => ({
    name: l.name.slice(0, 200),
    fb_url: l.fbUrl,
    business_type: opts.businessType,
    city_slug: opts.citySlug,
    description: l.description ?? null,
  }));

  const { error } = await sb
    .from("sponsor_outreach_leads")
    .upsert(rows, { onConflict: "fb_url" });
  if (error) return { error: error.message };

  const inserted = rows.filter((r) => !priorSet.has(r.fb_url)).length;
  const touched = rows.length - inserted;

  revalidatePath("/admin/sponsor-outreach");
  return { ok: true, inserted, touched };
}

/**
 * Mark a lead as contacted (or unmark). Mirrors setVenueMessaged()
 * in the venue outreach tool.
 */
export async function setLeadContacted(
  leadId: string,
  contacted: boolean,
): Promise<{ ok: true; at: string | null } | { error: string }> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };
  const at = contacted ? new Date().toISOString() : null;
  const sb = createServiceClient();
  const { error } = await sb
    .from("sponsor_outreach_leads")
    .update({ contacted_at: at })
    .eq("id", leadId);
  if (error) return { error: error.message };
  revalidatePath("/admin/sponsor-outreach");
  return { ok: true, at };
}

/**
 * Save free-text notes against a lead ("said maybe in May", "follow up
 * after holidays", "not interested" etc.). Empty string clears.
 */
export async function updateLeadNotes(
  leadId: string,
  notes: string,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };
  const trimmed = notes.trim();
  const sb = createServiceClient();
  const { error } = await sb
    .from("sponsor_outreach_leads")
    .update({ notes: trimmed.length > 0 ? trimmed.slice(0, 2000) : null })
    .eq("id", leadId);
  if (error) return { error: error.message };
  return { ok: true };
}

/**
 * Hard-delete a lead — used when admin wants to throw away a row that
 * was clearly junk (e.g. Brave surfaced a national chain).
 */
export async function deleteSponsorLead(
  leadId: string,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };
  const sb = createServiceClient();
  const { error } = await sb
    .from("sponsor_outreach_leads")
    .delete()
    .eq("id", leadId);
  if (error) return { error: error.message };
  revalidatePath("/admin/sponsor-outreach");
  return { ok: true };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
