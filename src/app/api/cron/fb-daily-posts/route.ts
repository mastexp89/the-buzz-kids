// Vercel Cron: post a daily "what's on for the kids today" roundup to The Buzz
// Kids Facebook Page — ONE national post spanning Scotland, with at most one
// pick per area and the areas rotating day to day, so every region gets airtime
// across a week and any follower can find their own town in the post.
//
// Why national rather than one post per area (the Buzz Guide's model): Kids
// covers 32 council areas. A post per area would be ~32 posts/day, and Facebook
// suppresses per-post reach when a Page floods the feed.
//
// IMPORTANT — Kids' event supply is NOT like the Guide's. On a typical day only
// a handful of one-off events start; almost all the volume is weekly clubs
// (recurrence_pattern) and multi-day runs (end_date). Querying start_time
// within today — as the Guide does — finds almost nothing, so we expand
// recurring series and multi-day runs onto today as well.
//
// Env (Vercel):
//   FB_PAGE_ID            — the Page's numeric id
//   FB_PAGE_ACCESS_TOKEN  — long-lived PAGE token (not a user token)
//
// Schedule (vercel.json): "30 7 * * *" — Vercel crons run in UTC and do NOT
// shift with BST, so that is 8:30am UK in summer, 7:30am in winter. Aimed at
// the school run, when parents are deciding what to do with the day.
//
// Query params:
//   ?dry=1      — build the caption, post nothing (returns it as JSON)
//   ?preview=1  — also render + store the image, return its URL, post nothing
//   ?city=slug  — restrict to one area (testing / a one-off local post)

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { pickEventIcon } from "@/lib/utils";
import { isRecurring, recurrenceOccursInWindow } from "@/lib/recurrence";
import { buildAndStorePostImage, type PostLine } from "@/lib/fb-post-image";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const SITE = "https://www.thebuzzkids.co.uk";
const TZ = "Europe/London";             // cities table has no timezone column; all Scottish
const MAX_PER_POST = 8;                 // one national roundup, spread across areas
const MAX_PER_AREA = 1;                 // maximum geographic spread
// Our home patch: always give Dundee a slot when it has anything on, before
// the rotation fills the rest of the post.
const HOME_AREA_SLUG = "dundee";
const MAX_PROMOTED = 2;                 // paid slots can't take over the post
// Kids activities are daytime and short — a 10am soft-play session is over by
// lunch. With no end_time, assume 2 hours rather than the Guide's "open until
// the venue shuts", so the post never lists something that has finished.
const DEFAULT_DURATION_MIN = 120;
// Event posters attached after our summary card — one for every pick that has
// one. Facebook allows 10 photos per feed post and we pick 8, so card + 8
// posters still fits, and the uploads finish inside maxDuration.
const MAX_POSTERS = MAX_PER_POST;

function timeLabel(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  let h = parseInt(get("hour"), 10);
  if (h === 24) h = 0;
  const m = parseInt(get("minute"), 10);
  const h12 = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? "am" : "pm";
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

// Age range as a short chip, e.g. "2–8 yrs", "Under 5s", "5+".
function ageLabel(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `${min}–${max} yrs`;
  if (min != null) return `${min}+`;
  return `Under ${(max as number) + 1}s`;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const preview = url.searchParams.get("preview") === "1";
  const onlyCity = url.searchParams.get("city");

  const pageId = process.env.FB_PAGE_ID;
  const token = process.env.FB_PAGE_ACCESS_TOKEN;

  // ?check=1 — verify the Facebook credentials WITHOUT posting anything. Asks
  // Graph who the token belongs to, so we can confirm it's a PAGE token for the
  // right Page before the cron ever fires unattended. Never echoes the token.
  if (url.searchParams.get("check") === "1") {
    if (!pageId || !token) {
      return NextResponse.json({
        ok: false,
        hasPageId: !!pageId,
        hasToken: !!token,
        error: "FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN not visible to the server (set them in Vercel Production, then redeploy).",
      });
    }
    try {
      const who = await fetch(
        `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(token)}`,
      );
      const whoJson: any = await who.json();
      const perms = await fetch(
        `https://graph.facebook.com/v21.0/me/permissions?access_token=${encodeURIComponent(token)}`,
      );
      const permsJson: any = await perms.json();
      const granted = (permsJson?.data ?? [])
        .filter((p: any) => p.status === "granted").map((p: any) => p.permission);
      // Fingerprint (not the token) so we can tell whether Vercel actually
      // picked up a NEW value after a redeploy — identical fingerprint means
      // the env var never changed, whatever was pasted into the dashboard.
      const { createHash } = await import("node:crypto");
      const fingerprint = createHash("sha256").update(token).digest("hex").slice(0, 8);

      return NextResponse.json({
        ok: !whoJson?.error,
        configuredPageId: pageId,
        tokenFingerprint: fingerprint,
        tokenLength: token.length,
        tokenBelongsTo: whoJson?.name ?? null,
        tokenId: whoJson?.id ?? null,
        matchesConfiguredPage: whoJson?.id === pageId,
        isPageToken: whoJson?.id === pageId,
        grantedPermissions: granted,
        error: whoJson?.error?.message ?? null,
      });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message ?? "check failed" });
    }
  }
  if (!dry && !preview && (!pageId || !token)) {
    return NextResponse.json(
      { ok: false, error: "FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN env vars not set." },
      { status: 500 },
    );
  }

  const sb = createServiceClient();
  let cq = sb.from("cities").select("id, name, slug").eq("active", true).order("name");
  if (onlyCity) cq = cq.eq("slug", onlyCity);
  const { data: cities } = await cq;
  const cityById = new Map((cities ?? []).map((c: any) => [c.id, c]));
  if ((cities ?? []).length === 0) {
    return NextResponse.json({ ok: false, error: "no active cities" }, { status: 200 });
  }

  // Today's window in UK local time.
  const now = new Date();
  const ymd = now.toLocaleDateString("en-CA", { timeZone: TZ });
  const dayStart = new Date(`${ymd}T00:00:00`);
  const dayEnd = new Date(`${ymd}T23:59:59`);

  // Pull every candidate in one query: anything that could touch today —
  // starting today, a multi-day run that hasn't ended, or a live recurring
  // series. Then decide per-row whether it actually lands today.
  // Three straightforward queries merged, rather than one clever .or().
  // A single .or() containing nested and(...) groups silently returned ZERO
  // rows through supabase-js (the same filter worked when called directly),
  // and because the error was ignored it looked like "nothing is on" — the
  // post would just never go out. Simple queries fail loudly instead.
  const EVENT_SELECT = `id, title, start_time, end_time, end_date, recurrence_pattern, recurrence_until,
             cancelled, status, is_free, cover_charge, age_min, age_max, location_name, image_url,
             highlighted_until, weekend_boost_until,
             venue:venues(id, name, city_id, approved),
             city:cities(id, slug, name, active),
             event_genres(genre:genres(slug))`;

  const base = () =>
    sb.from("events").select(EVENT_SELECT).eq("status", "approved").eq("cancelled", false);

  const [startsToday, multiDay, recurring] = await Promise.all([
    base()
      .gte("start_time", dayStart.toISOString())
      .lte("start_time", dayEnd.toISOString())
      .limit(1000),
    base().gte("end_date", ymd).limit(1000),
    base().not("recurrence_pattern", "is", null).limit(1000),
  ]);

  const queryErrors = [startsToday.error, multiDay.error, recurring.error]
    .filter(Boolean)
    .map((e: any) => e.message);

  // Merge, de-duplicating by id (a multi-day recurring event hits two queries).
  const byId = new Map<string, any>();
  for (const res of [startsToday, multiDay, recurring]) {
    for (const e of (res.data ?? []) as any[]) byId.set(e.id, e);
  }
  const rawEvents = [...byId.values()];

  // The occurrence that lands TODAY, keeping the series' time of day.
  const todaysOccurrence = (e: any): Date | null => {
    const start = new Date(e.start_time);
    if (Number.isNaN(start.getTime())) return null;

    const startsToday = start >= dayStart && start <= dayEnd;
    if (startsToday) return start;

    // A recurring series landing on today's weekday.
    if (isRecurring(e.recurrence_pattern) &&
        recurrenceOccursInWindow(e.recurrence_pattern, e.start_time, e.recurrence_until, dayStart, dayEnd)) {
      const d = new Date(dayStart);
      d.setHours(start.getHours(), start.getMinutes(), 0, 0);
      return d;
    }

    // A multi-day run (holiday camp, exhibition) still going today.
    if (e.end_date && e.end_date >= ymd && start <= dayEnd) {
      const d = new Date(dayStart);
      d.setHours(start.getHours(), start.getMinutes(), 0, 0);
      return d;
    }
    return null;
  };

  type Cand = { e: any; when: Date; allDay: boolean; cityId: string; citySlug: string; cityName: string; venueName: string };
  const candidates: Cand[] = [];
  for (const e of (rawEvents ?? []) as any[]) {
    // Attached to a place → that place must be approved; standalone → its own
    // area must be live. Mirrors the public listings' visibility rules.
    const v = e.venue;
    if (v && !v.approved) continue;
    const cityId = v?.city_id ?? e.city?.id;
    const city = cityId ? cityById.get(cityId) : null;
    if (!city) continue;                        // inactive/hidden area, or filtered by ?city=
    if (!v && e.city && e.city.active === false) continue;

    const when = todaysOccurrence(e);
    if (!when) continue;

    // Already finished? Use end_time when present, else assume 2 hours.
    const endsAt = e.end_time && new Date(e.end_time) > when
      ? new Date(e.end_time)
      : new Date(when.getTime() + DEFAULT_DURATION_MIN * 60 * 1000);
    // Multi-day runs are "on" all day, so only time-bound ones expire.
    const expired = !e.end_date && endsAt.getTime() <= now.getTime();
    if (expired) continue;

    // An exhibition / "summer season" that began before today isn't a 10am
    // session — it's open all day. Labelling it with the series' start time
    // both misleads and makes every line read "10am".
    const allDay = !!e.end_date && new Date(e.start_time) < dayStart;

    candidates.push({
      e, when, allDay, cityId,
      citySlug: city.slug,
      cityName: city.name,
      venueName: v?.name ?? e.location_name ?? "",
    });
  }

  if (candidates.length === 0) {
    // Report the raw row count too: "nothing on today" late in the evening is
    // correct (everything has finished), but a zero here with zero raw rows
    // would mean the query itself failed — very different problems.
    return NextResponse.json({
      ok: true, dry, ranAt: now.toISOString(),
      results: [{ skipped: "nothing on today", rawRows: rawEvents.length, ymd, queryErrors }],
    });
  }

  // ── Pick the line-up ──────────────────────────────────────────────
  // 1. Paid promos first (capped) — a concrete perk to sell.
  // 2. Then one per AREA, walking the areas in an order that rotates daily so
  //    coverage is fair over a week rather than always alphabetical.
  // 3. Within an area, prefer variety of activity type, earliest first.
  const isPromoted = (e: any) =>
    [e.highlighted_until, e.weekend_boost_until]
      .some((t: any) => t && new Date(t).getTime() > now.getTime());
  const genresOf = (e: any) =>
    (e.event_genres ?? []).map((eg: any) => eg?.genre?.slug).filter(Boolean) as string[];

  candidates.sort((a, b) => a.when.getTime() - b.when.getTime());

  const perArea = new Map<string, number>();
  const picks: Cand[] = [];
  const takeable = (c: Cand) => (perArea.get(c.cityId) ?? 0) < MAX_PER_AREA;
  const take = (c: Cand) => {
    perArea.set(c.cityId, (perArea.get(c.cityId) ?? 0) + 1);
    picks.push(c);
  };

  for (const c of candidates) {
    if (picks.length >= MAX_PROMOTED) break;
    if (isPromoted(c.e) && takeable(c)) take(c);
  }

  // Is this image a designed POSTER (portrait/square) rather than a snapshot
  // (landscape)? Measured once per URL, with a hard budget so a long candidate
  // list can't blow the function's time limit.
  type Shape = "poster" | "photo" | "unusable";
  const shapeCache = new Map<string, Shape>();
  let shapeBudget = 26;
  const shapeOf = async (u: unknown): Promise<Shape> => {
    if (typeof u !== "string" || !/^https?:\/\//.test(u)) return "unusable";
    const cached = shapeCache.get(u);
    if (cached !== undefined) return cached;
    if (shapeBudget <= 0) return "unusable";
    shapeBudget--;
    let out: Shape = "unusable";
    try {
      const res = await fetch(u, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; TheBuzzBot/1.0; +https://thebuzzkids.co.uk)" },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const { default: sharp } = await import("sharp");
        const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
        const w = meta.width ?? 0, h = meta.height ?? 0;
        // Tiny images are broken placeholders (we see 49x25 in the data).
        if (w >= 300 && h >= 300) out = h / w >= 0.95 ? "poster" : "photo";
      }
    } catch { /* leave unusable */ }
    shapeCache.set(u, out);
    return out;
  };
  const isPosterShaped = async (u: unknown) => (await shapeOf(u)) === "poster";

  // Home patch first (after promos): Dundee always gets a slot when something
  // is on there, so our own city never rotates out of the post.
  const homePick = candidates.find(
    (c) => c.citySlug === HOME_AREA_SLUG && takeable(c) && !picks.includes(c),
  );
  if (homePick && picks.length < MAX_PER_POST) take(homePick);

  // Daily rotation: offset the area order by the day number so a different set
  // of areas leads each day (deterministic, so re-runs match).
  const dayNumber = Math.floor(new Date(`${ymd}T00:00:00Z`).getTime() / 86_400_000);
  const areaIds = [...new Set(candidates.map((c) => c.cityId))];
  const rotated = areaIds.map((_, i) => areaIds[(i + dayNumber) % areaIds.length]);

  const usedTypes = new Set<string>();
  for (const areaId of rotated) {
    if (picks.length >= MAX_PER_POST) break;
    const inArea = candidates.filter((c) => c.cityId === areaId && takeable(c) && !picks.includes(c));
    if (inArea.length === 0) continue;
    // Prefer an activity type we haven't used yet, so the post reads varied —
    // and among equals prefer one that HAS an image, since a post carrying
    // real posters is far more eye-catching than the card alone. (Shape is
    // checked later; this just improves the odds of having one to attach.)
    const typeIsFresh = (c: Cand) =>
      !usedTypes.has(genresOf(c.e)[0] ?? pickEventIcon(c.e.title, []));

    // Prefer a pick whose image is an actual poster — checked here rather than
    // after the fact, otherwise an area's first candidate (often a landscape
    // snap) wins the slot and the post ends up with nothing to attach.
    let chosen: Cand | undefined;
    for (const c of inArea.slice(0, 4)) {
      if (await isPosterShaped(c.e.image_url)) { chosen = c; break; }
    }
    chosen = chosen ?? inArea.find(typeIsFresh) ?? inArea[0];
    usedTypes.add(genresOf(chosen.e)[0] ?? pickEventIcon(chosen.e.title, []));
    take(chosen);
  }

  // Timed sessions first (they're the time-sensitive ones), all-day runs after.
  picks.sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? 1 : -1;
    return a.when.getTime() - b.when.getTime();
  });
  if (picks.length < 2) {
    return NextResponse.json({ ok: true, dry, ranAt: now.toISOString(), results: [{ skipped: `only ${picks.length} on today` }] });
  }

  // ── Caption + image ───────────────────────────────────────────────
  const dateLabel = (() => {
    const d = new Date(`${ymd}T12:00:00Z`);
    const weekday = d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
    const month = d.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
    return `${weekday} ${ordinal(d.getUTCDate())} ${month}`;
  })();

  // Facebook has no rich text, so a bold headline means Unicode "bold" glyphs.
  // Screen readers handle those badly, so it is used ONLY on the one headline
  // line — never on the listings, which stay plain readable text.
  const BOLD_A = 0x1d5d4; // 𝗔 — mathematical sans-serif bold capital A
  const toBold = (t: string) =>
    t.replace(/[A-Z]/g, (ch) => String.fromCodePoint(BOLD_A + (ch.charCodeAt(0) - 65)));

  // NOTE: no @-tagging. Facebook rejects Page mentions from apps that haven't
  // been through Meta App Review (confirmed on The Buzz Guide, 21 Aug 2026), so
  // attempting it only risked a rejected post and a retry. Plain names instead.
  // Two lines per pick: what it is, then where. Far easier to scan than one
  // long run-on line, and the activity icon gives the eye something to catch.
  const lineFor = (c: Cand) => {
    const star = isPromoted(c.e) ? "⭐ " : "";
    const free = c.e.is_free ? " · FREE" : "";
    const icon = pickEventIcon(c.e.title, genresOf(c.e));
    const when = c.allDay ? "All day" : timeLabel(c.when);
    const where = c.venueName ? `${c.venueName}, ${c.cityName}` : c.cityName;
    return `${star}${icon} ${when} · ${c.e.title}${free}` + "\n" + `     📍 ${where}`;
  };

  const lines = picks.map((c) => lineFor(c));

  const imageLines: PostLine[] = picks.map((c) => ({
    time: c.allDay ? "All day" : timeLabel(c.when),
    title: c.e.title,
    venue: c.venueName,
    area: c.cityName,
    icon: pickEventIcon(c.e.title, genresOf(c.e)),
    promoted: isPromoted(c.e),
    free: !!c.e.is_free,
    ages: ageLabel(c.e.age_min ?? null, c.e.age_max ?? null),
  }));

  const areaCount = new Set(candidates.map((c) => c.cityId)).size;
  const head =
    `🐝 ${toBold("WHAT'S ON FOR THE KIDS TODAY")}\n${dateLabel}\n\n` +
    `A few ideas from around Scotland 👇\n\n`;
  const tail =
    `\n\nLoads more — find what's on near you:`;
  const message = head + lines.join("\n\n") + tail;
  const link = onlyCity ? `${SITE}/${onlyCity}/whats-on` : `${SITE}/browse?tab=events`;

  if (dry && !preview) {
    return NextResponse.json({
      ok: true, dry: true, ranAt: now.toISOString(),
      results: [{
        message, link,
        picked: picks.length, onToday: candidates.length, areasWithSomethingOn: areaCount,
        areas: picks.map((c) => c.cityName),
        imagesAvailable: picks.filter((c) => typeof c.e.image_url === "string" && /^https?:\/\//.test(c.e.image_url)).length,
        imageLines,
      }],
    });
  }

  // Posters for the featured events, in the same order as the caption lines.
  //
  // Only actual POSTERS, not photographs. Every event image here is
  // event-specific (none duplicate the venue photo), but many are generic
  // scraped snaps — a stock shot of a swimming pool does nothing for a kids'
  // roundup. Designed flyers are portrait or square; photographs are almost
  // always landscape, so shape is a reliable, cheap discriminator.
  const posterUrls: string[] = [];
  const photoUrls: string[] = [];
  const seenPoster = new Set<string>();
  for (const c of picks) {
    if (posterUrls.length >= MAX_POSTERS) break;
    const u = c.e.image_url;
    if (typeof u !== "string" || !/^https?:\/\//.test(u) || seenPoster.has(u)) continue;
    seenPoster.add(u);
    const shape = await shapeOf(u);
    if (shape === "poster") posterUrls.push(u);
    else if (shape === "photo") photoUrls.push(u);
  }
  // Real posters lead. Most event images are landscape photos, so on days with
  // few posters fall back to decent-quality photos rather than posting the card
  // alone — broken/tiny images are excluded either way.
  const attachUrls = [...posterUrls, ...photoUrls].slice(0, MAX_POSTERS);

  const imageUrl = await buildAndStorePostImage(sb, {
    citySlug: onlyCity ?? "scotland",
    cityName: onlyCity ? (cities ?? [])[0]?.name ?? "Scotland" : "Scotland",
    dateLabel, ymd, lines: imageLines,
    totalToday: candidates.length, venueCount: areaCount,
    logoUrl: `${SITE}/logo.png`,
  });

  if (preview) {
    return NextResponse.json({
      ok: true, preview: true, previewImage: imageUrl, message,
      picked: picks.length, onToday: candidates.length,
      postersThatQualify: posterUrls.length, photosAsFallback: photoUrls.length,
      willAttach: attachUrls.length, posterUrls,
    });
  }

  // Upload photos UNPUBLISHED, then create a feed post attaching them: the
  // photo endpoint's `caption` doesn't support @-mentions, the feed endpoint's
  // `message` does. Falls back to a link post if everything fails, so an image
  // problem never costs us the post.
  //
  // Our summary card goes FIRST (it's the lead image in the feed), followed by
  // the actual event posters — a multi-photo post takes far more feed space and
  // the real posters are what catch a parent's eye. Any poster that won't
  // upload is simply skipped.
  const uploadPhoto = async (photoUrl: string): Promise<string | null> => {
    try {
      const up = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: photoUrl, published: false, access_token: token }),
      });
      const upJson: any = await up.json();
      return up.ok && upJson.id ? (upJson.id as string) : null;
    } catch {
      return null;
    }
  };

  const mediaIds: string[] = [];
  if (imageUrl) {
    const id = await uploadPhoto(imageUrl);
    if (id) mediaIds.push(id);
  }
  for (const p of attachUrls) {
    const id = await uploadPhoto(p);
    if (id) mediaIds.push(id);
  }
  const mediaId = mediaIds[0] ?? null;

  const publish = async (msg: string) => {
    const body: Record<string, unknown> = mediaIds.length > 0
      ? {
          message: `${msg}\n${link}`,
          attached_media: mediaIds.map((id) => ({ media_fbid: id })),
          access_token: token,
        }
      : { message: msg, link, access_token: token };
    const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json: any = await res.json();
    return { ok: res.ok && !json.error, json, status: res.status };
  };

  try {
    const attempt = await publish(message);
    const json: any = attempt.json;
    if (!attempt.ok) {
      return NextResponse.json({
        ok: false, ranAt: now.toISOString(),
        error: json?.error?.message ?? `HTTP ${attempt.status}`,
      });
    }
    return NextResponse.json({
      ok: true, ranAt: now.toISOString(),
      results: [{
        posted: json.id, picked: picks.length, onToday: candidates.length,
        areas: picks.map((c) => c.cityName), withImage: !!mediaId,
        photosAttached: mediaIds.length, postersAttached: Math.max(0, mediaIds.length - 1),
      }],
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "post failed" });
  }
}
