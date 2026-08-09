// Telegram admin notifications for The Buzz Kids — posts into the shared
// admins group (same group as The Buzz Guide bot, different bot account),
// with inline Approve/Reject buttons handled by /api/telegram/webhook.
//
// Required env vars (Vercel Production + Preview, and .env.local):
//   TELEGRAM_BOT_TOKEN        the Buzz KIDS bot's token from @BotFather
//   TELEGRAM_CHAT_ID          the shared admins group chat id
//   TELEGRAM_WEBHOOK_SECRET   random string, also passed to setWebhook
//
// All sends are best-effort — failures log and return false, never throw.
// With the env vars unset every function is a no-op, so calling these
// unconditionally from server actions is safe.

const API_BASE = "https://api.telegram.org";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.thebuzzkids.co.uk";

export type TgButton = { text: string; callback_data?: string; url?: string };

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/** Numeric bot id — the part of the token before the colon. */
export function tgBotId(): number | null {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  const id = Number(token.split(":")[0]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// Cached getMe result so command @-addressing can be checked without an
// API call per update. One fetch per lambda instance.
let cachedUsername: string | null = null;
export async function tgBotUsername(): Promise<string | null> {
  if (cachedUsername) return cachedUsername;
  const me = await tgApi("getMe", {});
  cachedUsername = me?.username ?? null;
  return cachedUsername;
}

/** Raw Bot API call. Returns the `result` payload or null on any failure. */
export async function tgApi(method: string, payload: Record<string, any>): Promise<any | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      console.warn(`[telegram] ${method} failed:`, res.status, JSON.stringify(json)?.slice(0, 300));
      return null;
    }
    return json.result;
  } catch (e: any) {
    console.warn(`[telegram] ${method} error:`, e?.message ?? e);
    return null;
  }
}

export async function sendTelegram(
  text: string,
  opts: {
    buttons?: TgButton[][];
    silent?: boolean;
    chatId?: string | number;
    replyTo?: number;
  } = {},
): Promise<boolean> {
  const chatId = opts.chatId ?? process.env.TELEGRAM_CHAT_ID;
  if (!chatId) return false;
  const payload: Record<string, any> = {
    chat_id: chatId,
    text: text.slice(0, 4000),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  };
  if (opts.silent) payload.disable_notification = true;
  if (opts.replyTo) payload.reply_parameters = { message_id: opts.replyTo };
  if (opts.buttons?.length) payload.reply_markup = { inline_keyboard: opts.buttons };
  const result = await tgApi("sendMessage", payload);
  return result != null;
}

export function tgEsc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** "Fri 15th Aug, 8:00pm" in UK time, with the ordinal day suffix. */
export function tgDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = Number(get("day"));
  const suffix =
    day % 100 >= 11 && day % 100 <= 13 ? "th"
    : day % 10 === 1 ? "st"
    : day % 10 === 2 ? "nd"
    : day % 10 === 3 ? "rd"
    : "th";
  const time = `${get("hour")}:${get("minute")}${get("dayPeriod").toLowerCase()}`;
  return `${get("weekday")} ${day}${suffix} ${get("month")}, ${time}`;
}

// ---------------------------------------------------------------------------
// Callback-data codes handled by /api/telegram/webhook (64-byte cap):
//   ev:ap / ev:rj   approve / reject a pending event
//   ar:ap           approve an artist
//   rv:ap / rv:hd   approve / hide a review
//   sg:dn           mark an edit suggestion done
//   cmd:*           /help button shortcuts
// ---------------------------------------------------------------------------
export const CB = {
  approveEvent: (id: string) => `ev:ap:${id}`,
  rejectEvent: (id: string) => `ev:rj:${id}`,
  approveArtist: (id: string) => `ar:ap:${id}`,
  approveReview: (id: string) => `rv:ap:${id}`,
  hideReview: (id: string) => `rv:hd:${id}`,
  suggestionDone: (id: string) => `sg:dn:${id}`,
} as const;

// ---------------------------------------------------------------------------
// Notification builders
// ---------------------------------------------------------------------------

export function tgNewSignup(opts: {
  displayName: string | null;
  email: string | null;
  accountType: string;
}) {
  const t = (opts.accountType || "").toLowerCase();
  const typeLabel =
    t === "fan" || t === "parent" || t === "user" || t === "" ? "Parent"
    : t === "venue" ? "Place / business"
    : t === "artist" ? "Activity provider"
    : t === "organiser" ? "Organiser"
    : opts.accountType;
  return sendTelegram(
    `👨‍👧 <b>New signup</b> — ${tgEsc(typeLabel)}\n` +
    `${tgEsc(opts.displayName ?? "—")} · ${tgEsc(opts.email ?? "—")}`,
    { silent: true },
  );
}

/** New event on the site — pending ones get Approve/Reject buttons. */
export function tgNewGig(opts: {
  eventId: string;
  title: string;
  venueName: string;
  startTime: string | null;
  byEmail: string | null;
  status: "pending" | "approved";
  source: string;
}) {
  const head = opts.status === "pending"
    ? "🎪 <b>New event — needs approval</b>"
    : "🎪 <b>New event added</b>";
  const text =
    `${head}\n` +
    `<b>${tgEsc(opts.title)}</b>\n` +
    `📍 ${tgEsc(opts.venueName)}\n` +
    `🗓 ${tgEsc(tgDate(opts.startTime))}\n` +
    `Via ${tgEsc(opts.source)} · ${tgEsc(opts.byEmail ?? "—")}\n` +
    `ID: <code>${opts.eventId}</code>`;
  const buttons: TgButton[][] = opts.status === "pending"
    ? [[
        { text: "✅ Approve", callback_data: CB.approveEvent(opts.eventId) },
        { text: "❌ Reject", callback_data: CB.rejectEvent(opts.eventId) },
      ]]
    : [];
  return sendTelegram(text, { buttons, silent: opts.status === "approved" });
}

export function tgVenueSuggestion(opts: {
  venueName: string;
  cityName: string | null;
  gigTitle: string | null;
  byEmail: string | null;
  contact: string | null;
}) {
  return sendTelegram(
    `💡 <b>Place suggestion</b>\n` +
    `<b>${tgEsc(opts.venueName)}</b> · ${tgEsc(opts.cityName ?? "—")}\n` +
    `Event: ${tgEsc(opts.gigTitle ?? "—")}\n` +
    `From: ${tgEsc(opts.byEmail ?? "—")} · ${tgEsc(opts.contact ?? "—")}`,
    { buttons: [[{ text: "🔍 Review suggestion", url: `${SITE}/admin/queue` }]] },
  );
}

/** Suggest-an-edit / new-place lead — the Kids lead model's main artery. */
export function tgEditSuggestion(opts: {
  suggestionId?: string;
  targetType: string;
  targetName: string | null;
  reason: string | null;
  details: string | null;
  contactName: string | null;
  contactEmail: string | null;
  isOwner: boolean;
  imageUrl?: string | null;
}) {
  const kindLabel =
    opts.targetType === "new_place" ? "🏰 <b>New place request</b>"
    : opts.targetType === "event" ? "✏️ <b>Event edit suggestion</b>"
    : "✏️ <b>Place edit suggestion</b>";
  const detail = (opts.details ?? "").slice(0, 400);
  const buttons: TgButton[][] = [];
  const row: TgButton[] = [];
  if (opts.suggestionId) row.push({ text: "✅ Mark done", callback_data: CB.suggestionDone(opts.suggestionId) });
  row.push({ text: "🔍 Review", url: `${SITE}/admin/suggestions` });
  buttons.push(row);
  if (opts.imageUrl) buttons.push([{ text: "🖼 View attached photo", url: opts.imageUrl }]);
  return sendTelegram(
    `${kindLabel}${opts.isOwner ? " — from the owner" : ""}\n` +
    `<b>${tgEsc(opts.targetName ?? "—")}</b>\n` +
    `Reason: ${tgEsc(opts.reason ?? "—")}\n` +
    (detail ? `“${tgEsc(detail)}”\n` : "") +
    `Contact: ${tgEsc([opts.contactName, opts.contactEmail].filter(Boolean).join(" · ") || "—")}`,
    { buttons },
  );
}

export function tgNewReview(opts: {
  reviewId: string;
  venueName: string;
  rating: number;
  title: string | null;
  body: string | null;
  authorName: string | null;
}) {
  const stars = "⭐".repeat(Math.max(1, Math.min(5, opts.rating)));
  const bodyPreview = (opts.body ?? "").slice(0, 300);
  return sendTelegram(
    `📝 <b>New review — needs approval</b>\n` +
    `<b>${tgEsc(opts.venueName)}</b> — ${stars}\n` +
    (opts.title ? `<b>${tgEsc(opts.title)}</b>\n` : "") +
    (bodyPreview ? `“${tgEsc(bodyPreview)}”\n` : "") +
    `By: ${tgEsc(opts.authorName ?? "a parent")}`,
    {
      buttons: [[
        { text: "✅ Approve", callback_data: CB.approveReview(opts.reviewId) },
        { text: "🙈 Hide", callback_data: CB.hideReview(opts.reviewId) },
        { text: "🔍 All reviews", url: `${SITE}/admin/reviews` },
      ]],
    },
  );
}

export function tgOfferSuggestion(opts: {
  title: string;
  provider: string | null;
  category: string;
  byEmail: string | null;
}) {
  return sendTelegram(
    `🎁 <b>New deal suggestion</b>\n` +
    `<b>${tgEsc(opts.title)}</b>${opts.provider ? ` — ${tgEsc(opts.provider)}` : ""}\n` +
    `Type: ${tgEsc(opts.category)} · From: ${tgEsc(opts.byEmail ?? "—")}`,
    { buttons: [[{ text: "🔍 Review deals", url: `${SITE}/admin/offers` }]] },
  );
}

export function tgNewsletterSignup(opts: { email: string }) {
  return sendTelegram(
    `📬 <b>Newsletter signup</b>\n${tgEsc(opts.email)}`,
    { silent: true },
  );
}

export function tgNewVenue(opts: {
  venueId: string;
  venueName: string;
  cityName: string | null;
  byEmail: string | null;
}) {
  return sendTelegram(
    `🏰 <b>New place pending approval</b>\n` +
    `<b>${tgEsc(opts.venueName)}</b> · ${tgEsc(opts.cityName ?? "—")}\n` +
    `Owner: ${tgEsc(opts.byEmail ?? "—")}`,
    { buttons: [[{ text: "🔍 Review in admin", url: `${SITE}/admin/queue` }]] },
  );
}

export function tgNewArtist(opts: {
  artistId: string;
  artistName: string;
  byEmail: string | null;
}) {
  return sendTelegram(
    `🎭 <b>New activity provider pending</b>\n` +
    `<b>${tgEsc(opts.artistName)}</b>\n` +
    `Registered by: ${tgEsc(opts.byEmail ?? "—")}`,
    {
      buttons: [[
        { text: "✅ Approve", callback_data: CB.approveArtist(opts.artistId) },
        { text: "🔍 Open queue", url: `${SITE}/admin/queue` },
      ]],
    },
  );
}

export function tgNewOrganiser(opts: {
  organiserId: string;
  organiserName: string;
  byEmail: string | null;
}) {
  return sendTelegram(
    `📋 <b>New organiser pending approval</b>\n` +
    `<b>${tgEsc(opts.organiserName)}</b>\n` +
    `Registered by: ${tgEsc(opts.byEmail ?? "—")}`,
    { buttons: [[{ text: "🔍 Review in admin", url: `${SITE}/admin/queue` }]] },
  );
}

// Claim flows are dormant on Buzz Kids (suggest-an-edit replaced them) but
// the URLs still work — so claims link to the web queue rather than carrying
// one-tap buttons.
export function tgVenueClaim(opts: {
  venueName: string;
  claimantName: string | null;
  claimantEmail: string | null;
  businessName: string | null;
  reason: string | null;
}) {
  return sendTelegram(
    `🔑 <b>Place ownership claim</b>\n` +
    `<b>${tgEsc(opts.venueName)}</b>\n` +
    `By: ${tgEsc(opts.claimantName ?? "—")} · ${tgEsc(opts.claimantEmail ?? "—")}\n` +
    `Business: ${tgEsc(opts.businessName ?? "—")}\n` +
    `Reason: ${tgEsc(opts.reason ?? "—")}`,
    { buttons: [[{ text: "🔍 Review in admin queue", url: `${SITE}/admin/queue` }]] },
  );
}

export function tgArtistClaim(opts: {
  artistName: string;
  claimantName: string | null;
  claimantEmail: string | null;
  reason: string | null;
}) {
  return sendTelegram(
    `🔑 <b>Provider page claim</b>\n` +
    `<b>${tgEsc(opts.artistName)}</b>\n` +
    `By: ${tgEsc(opts.claimantName ?? "—")} · ${tgEsc(opts.claimantEmail ?? "—")}\n` +
    `Reason: ${tgEsc(opts.reason ?? "—")}`,
    { buttons: [[{ text: "🔍 Review in admin queue", url: `${SITE}/admin/queue` }]] },
  );
}

export function tgAdminMessage(opts: {
  fromName: string | null;
  fromEmail: string | null;
  body: string;
  userId: string;
}) {
  const preview = opts.body.length > 300 ? `${opts.body.slice(0, 300)}…` : opts.body;
  return sendTelegram(
    `💬 <b>New message from a user</b>\n` +
    `${tgEsc(opts.fromName ?? "—")} · ${tgEsc(opts.fromEmail ?? "—")}\n\n` +
    `“${tgEsc(preview)}”`,
    { buttons: [[{ text: "↩️ Reply in admin", url: `${SITE}/admin/messages/${opts.userId}` }]] },
  );
}

export function tgAccountDeleted(opts: { email: string | null; venueCount: number }) {
  return sendTelegram(
    `👋 <b>Account deleted</b>\n` +
    `${tgEsc(opts.email ?? "(unknown email)")}` +
    (opts.venueCount > 0 ? `\nRemoved ${opts.venueCount} owned place${opts.venueCount === 1 ? "" : "s"}` : ""),
  );
}

/** Morning review-queue digest — mirrors the queue-digest email cron. */
export function tgQueueDigest(opts: {
  events: number;
  suggestions: number;
  places: number;
  reviews: number;
}) {
  const total = opts.events + opts.suggestions + opts.places + opts.reviews;
  const lines = [
    opts.events ? `📅 Events to approve: ${opts.events}` : null,
    opts.suggestions ? `✏️ Edit suggestions: ${opts.suggestions}` : null,
    opts.places ? `📍 Places to add: ${opts.places}` : null,
    opts.reviews ? `📝 Reviews to moderate: ${opts.reviews}` : null,
  ].filter(Boolean);
  return sendTelegram(
    `🌅 <b>Morning! ${total} thing${total === 1 ? "" : "s"} in the Buzz Kids review queue</b>\n` +
    lines.join("\n"),
    {
      buttons: [
        [
          { text: "📅 Queue", url: `${SITE}/admin/queue` },
          { text: "✏️ Suggestions", url: `${SITE}/admin/suggestions` },
        ],
        [
          { text: "📍 Places", url: `${SITE}/admin/aggregator` },
          { text: "📝 Reviews", url: `${SITE}/admin/reviews` },
        ],
      ],
    },
  );
}
