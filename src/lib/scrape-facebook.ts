// Facebook scraper helper — calls Apify's Facebook Pages Scraper actor.
// Apify handles the FB session, anti-bot stuff, and returns structured posts.
// Setup: see CUSTOM-SEARCH-SETUP.md (or APIFY-SETUP.md) for getting a token.

// apify/facebook-posts-scraper is purpose-built for post content — text, images,
// external links — which is what we need for AI gig extraction.
// Pricing: $5 / 1000 posts. ~186 venues × 5 posts ≈ $5 per full run.
const DEFAULT_ACTOR = "apify~facebook-posts-scraper";
const APIFY_API = "https://api.apify.com/v2";

export type ScrapedPost = {
  url: string;
  text: string;
  imageUrls: string[];
  postedAt: string; // ISO
};

export type FacebookPageMeta = {
  // FB page profile picture — usually the venue exterior, signage, or logo.
  // Used as a fallback "cover photo" when no manual logo is set.
  profilePictureUrl: string | null;
  // Cover photo if Apify returns one (less commonly available)
  coverPictureUrl: string | null;
  pageName: string | null;
};

export async function scrapeVenueFacebook(opts: {
  facebookUrl: string;
  apifyToken: string;
  actorId?: string;
  maxPosts?: number;
}): Promise<{ posts: ScrapedPost[]; pageMeta: FacebookPageMeta; raw: any }> {
  const actor = opts.actorId ?? DEFAULT_ACTOR;
  const maxPosts = opts.maxPosts ?? 8;

  // run-sync-get-dataset-items returns the dataset items inline (no polling needed),
  // but takes a few seconds for FB. Caller should expect 5-30s per page.
  const url = `${APIFY_API}/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(opts.apifyToken)}`;

  // facebook-posts-scraper accepts startUrls (object form) and resultsLimit.
  // Some other FB actors take maxPosts or onlyPostsNewerThan — set both common
  // field names so changing the actor ID doesn't break input.
  const body = {
    startUrls: [{ url: opts.facebookUrl }],
    resultsLimit: maxPosts,
    maxPosts,
    onlyPostsNewerThan: "30 days",
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify ${res.status}: ${text.slice(0, 400)}`);
  }

  const items: any[] = await res.json();
  // Different actors return slightly different shapes — try to normalise.
  const posts = items
    .map((it) => normalisePost(it))
    .filter((p): p is ScrapedPost => !!p)
    .slice(0, maxPosts);

  // Page metadata is the same across every post from one page; pick the first
  // available value. Apify exposes user/profilePicture/page fields under varying
  // keys depending on the actor version.
  const pageMeta = extractPageMeta(items);

  return { posts, pageMeta, raw: items };
}

function extractPageMeta(items: any[]): FacebookPageMeta {
  let profilePictureUrl: string | null = null;
  let coverPictureUrl: string | null = null;
  let pageName: string | null = null;
  for (const it of items) {
    if (!profilePictureUrl) {
      profilePictureUrl =
        it?.user?.profilePic ??
        it?.user?.profilePicture ??
        it?.user?.profile_pic ??
        it?.user?.image ??
        it?.author?.profilePic ??
        it?.author?.profilePicture ??
        it?.page?.profilePic ??
        it?.page?.profilePicture ??
        it?.page?.image ??
        it?.profilePic ??
        it?.profilePicture ??
        null;
    }
    if (!coverPictureUrl) {
      coverPictureUrl =
        it?.user?.coverPhoto ??
        it?.user?.cover_photo ??
        it?.page?.coverPhoto ??
        it?.page?.cover_photo ??
        it?.coverPhoto ??
        it?.cover_photo ??
        null;
    }
    if (!pageName) {
      pageName =
        it?.user?.name ??
        it?.author?.name ??
        it?.page?.name ??
        it?.pageName ??
        null;
    }
    if (profilePictureUrl && coverPictureUrl && pageName) break;
  }
  return { profilePictureUrl, coverPictureUrl, pageName };
}

function normalisePost(item: any): ScrapedPost | null {
  // Common field names across Apify's various FB scrapers
  const text =
    item.text ??
    item.message ??
    item.postText ??
    item.caption ??
    "";
  const url =
    item.url ??
    item.postUrl ??
    item.link ??
    "";
  const postedAt =
    item.publishedTime ??
    item.time ??
    item.timestamp ??
    item.postedAt ??
    new Date().toISOString();

  const imageUrls: string[] = [];
  // Various shapes for images
  if (Array.isArray(item.images)) {
    for (const img of item.images) {
      if (typeof img === "string") imageUrls.push(img);
      else if (img?.url) imageUrls.push(img.url);
      else if (img?.src) imageUrls.push(img.src);
    }
  }
  if (Array.isArray(item.media)) {
    for (const m of item.media) {
      if (m?.url || m?.src || m?.image) imageUrls.push(m.url ?? m.src ?? m.image);
    }
  }
  if (item.image) imageUrls.push(item.image);
  if (item.thumbnail) imageUrls.push(item.thumbnail);

  // Drop dupes
  const uniqueImages = Array.from(new Set(imageUrls.filter(Boolean)));

  if (!text && uniqueImages.length === 0) return null;

  return {
    url: typeof url === "string" ? url : "",
    text: typeof text === "string" ? text : "",
    imageUrls: uniqueImages.slice(0, 6),
    postedAt: typeof postedAt === "string" ? postedAt : new Date().toISOString(),
  };
}
