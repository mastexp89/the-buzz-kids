// "Find deals" sweep — fetch a set of family-savings roundup pages, AI-extract
// the individual deals, dedupe against what we already have, and draft the new
// ones into the offers table as approved=false (pending). The admin reviews and
// publishes them from /admin/offers. Reuses the same fetch + AI stack as the
// events importer. No affiliate links here — that's a later phase.

import { createServiceClient } from "@/lib/supabase/service";
import { fetchRawHtml, htmlToText } from "@/lib/scrape-website";
import { extractDeals, type ExtractedDeal } from "@/lib/extraction";

// A sensible starting set — the admin can edit/prune these in the UI. Kept
// short on purpose; add your own trusted roundups.
export const DEFAULT_DEAL_SOURCES: string[] = [
  "https://www.moneysavingexpert.com/family/kids-eat-free/",
  "https://www.dayoutwiththekids.co.uk/blog/kids-eat-free-2024",
];

export type DealSweepResult = {
  ok: boolean;
  dry: boolean;
  urlsTried: number;
  pagesRead: number;
  found: number;
  duplicates: number;
  inserted: number;
  samples: {
    title: string;
    provider: string | null;
    category: string;
    scope: string;
    region: string | null;
    ends_on: string | null;
    duplicate: boolean;
  }[];
  warnings: string[];
  error?: string;
};

function norm(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Dedupe key: a chain repeats across roundups, so match on provider+category
// when we have a provider ("Asda" food = one deal however it's worded);
// otherwise fall back to the normalised title.
function dedupeKey(d: { provider: string | null; category: string; title: string }): string {
  const p = norm(d.provider);
  return p ? `${p}|${d.category}` : `t:${norm(d.title)}`;
}

export async function runDealSweep(urls: string[], dry: boolean): Promise<DealSweepResult> {
  const out: DealSweepResult = {
    ok: false, dry, urlsTried: 0, pagesRead: 0, found: 0,
    duplicates: 0, inserted: 0, samples: [], warnings: [],
  };
  if (!process.env.ANTHROPIC_API_KEY) return { ...out, error: "ANTHROPIC_API_KEY isn't set on the server." };

  const clean = urls.map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u));
  if (clean.length === 0) return { ...out, error: "No valid URLs to sweep." };
  out.urlsTried = clean.length;

  const sb = createServiceClient();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

  // Existing offers → dedupe set. Also city lookup for local deals.
  const { data: existing } = await sb.from("offers").select("title, provider, category");
  const seen = new Set<string>((existing ?? []).map((o: any) => dedupeKey(o)));
  const { data: cities } = await sb.from("cities").select("id, name, slug");
  const cityList = (cities ?? []) as { id: string; name: string; slug: string }[];

  const matchCity = (region: string | null): string | null => {
    if (!region) return null;
    const n = norm(region);
    const hit = cityList.find((c) => norm(c.name) === n || norm(c.slug) === n)
      ?? cityList.find((c) => n && (norm(c.name).includes(n) || n.includes(norm(c.name))));
    return hit?.id ?? null;
  };

  const toInsert: any[] = [];

  for (const url of clean) {
    const page = await fetchRawHtml(url);
    if ("error" in page) {
      out.warnings.push(`${url}: ${page.error}`);
      continue;
    }
    out.pagesRead++;
    const text = htmlToText(page.html);
    if (text.length < 200) {
      out.warnings.push(`${url}: page had almost no readable text (JS-only?).`);
      continue;
    }

    let deals: ExtractedDeal[] = [];
    try {
      deals = await extractDeals({ pageText: text, sourceUrl: page.finalUrl, today });
    } catch (e: any) {
      out.warnings.push(`${url}: AI extract failed — ${e?.message ?? e}`);
      continue;
    }

    for (const d of deals) {
      out.found++;
      const key = dedupeKey(d);
      const duplicate = seen.has(key);
      if (out.samples.length < 60) {
        out.samples.push({
          title: d.title, provider: d.provider, category: d.category,
          scope: d.scope, region: d.region, ends_on: d.ends_on, duplicate,
        });
      }
      if (duplicate) { out.duplicates++; continue; }
      seen.add(key); // also dedupe within this run
      toInsert.push({
        category: d.category,
        title: d.title,
        provider: d.provider,
        description: d.description,
        terms: d.terms,
        url: d.url ?? page.finalUrl,
        business_url: d.business_url,
        scope: d.scope,
        city_id: d.scope === "local" ? matchCity(d.region) : null,
        ends_on: d.ends_on,
        approved: false, // draft — admin reviews in /admin/offers
        sort_order: 0,
      });
    }
  }

  out.ok = true;
  if (dry || toInsert.length === 0) return out;

  // Insert in one go; ignore any title-unique collisions (offers.title is unique).
  for (let i = 0; i < toInsert.length; i += 100) {
    const batch = toInsert.slice(i, i + 100);
    const { error } = await sb
      .from("offers")
      .upsert(batch, { onConflict: "title", ignoreDuplicates: true });
    if (error) out.warnings.push(`insert: ${error.message}`);
    else out.inserted += batch.length;
  }
  return out;
}
