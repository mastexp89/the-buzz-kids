import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { tgApi, sendTelegram, tgEsc, tgDate, tgBotId, tgBotUsername } from "@/lib/telegram";
import {
  resolveDefaultReviewerId,
  approveEventCore,
  rejectEventCore,
  approveArtistCore,
  setReviewStatusCore,
  setSuggestionStatusCore,
} from "@/lib/moderation";
import { uploadPosterFromUrl } from "@/lib/poster-storage";
import { sendPendingEventButtons } from "@/lib/telegram-queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/telegram/webhook — The Buzz Kids admin bot.
 *
 * Lives in the SAME admins group as The Buzz Guide bot, so every handler
 * checks the update was aimed at THIS bot before responding:
 *   - commands addressed "/cmd@OtherBot" are ignored
 *   - photo replies are only handled when replying to THIS bot's message
 * Security: setWebhook secret_token header + TELEGRAM_CHAT_ID group gate.
 *
 * Handles:
 *   - Approve/Reject buttons: pending events, providers, reviews, edit
 *     suggestions ("Mark done")
 *   - Reply-with-photo → event poster (via poster-storage pipeline)
 *   - Commands: /pending /stats /chatid /help
 */
export async function POST(req: NextRequest) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const got = req.headers.get("x-telegram-bot-api-secret-token");
    if (got !== expectedSecret) {
      return NextResponse.json({ error: "Bad secret" }, { status: 401 });
    }
  }

  const update = await req.json().catch(() => null);
  if (!update) return NextResponse.json({ ok: true });

  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else if (update.message) {
      await handleMessage(update.message);
    }
  } catch (e: any) {
    // Always 200 — a 5xx makes Telegram retry the same update in a loop.
    console.error("[telegram webhook] handler error:", e?.message ?? e);
  }
  return NextResponse.json({ ok: true });
}

function isAdminChat(chatId: unknown): boolean {
  const expected = process.env.TELEGRAM_CHAT_ID;
  return Boolean(expected && String(chatId) === String(expected));
}

// ---------------------------------------------------------------------------
// Inline-keyboard callbacks
// ---------------------------------------------------------------------------

async function handleCallback(cb: any) {
  const answer = (text: string, alert = false) =>
    tgApi("answerCallbackQuery", { callback_query_id: cb.id, text: text.slice(0, 190), show_alert: alert });

  if (!isAdminChat(cb.message?.chat?.id)) {
    await answer("This bot only works in the admins group.");
    return;
  }

  const data = String(cb.data ?? "");

  // Command shortcuts from the /help buttons.
  if (data.startsWith("cmd:")) {
    await answer("");
    const cmd = data.slice(4);
    if (cmd === "pending") await handlePendingCommand();
    else if (cmd === "stats") await handleStatsCommand();
    else if (cmd === "help") await sendHelp();
    return;
  }

  const m = data.match(/^(ev|ar|rv|sg):(ap|rj|hd|dn):([0-9a-f-]{36})$/i);
  if (!m) {
    await answer("Unknown action.");
    return;
  }
  const [, entity, verb, id] = m;

  const reviewerId = await resolveDefaultReviewerId();
  if (!reviewerId) {
    await answer("No admin profile found to attribute this review to.", true);
    return;
  }

  let result;
  let actionLabel = "";
  let positive = true;
  if (entity === "ev" && verb === "ap") { result = await approveEventCore(reviewerId, id); actionLabel = "Event approved"; }
  else if (entity === "ev" && verb === "rj") { result = await rejectEventCore(reviewerId, id); actionLabel = "Event rejected"; positive = false; }
  else if (entity === "ar" && verb === "ap") { result = await approveArtistCore(reviewerId, id); actionLabel = "Provider approved"; }
  else if (entity === "rv" && verb === "ap") { result = await setReviewStatusCore(reviewerId, id, "approved"); actionLabel = "Review approved"; }
  else if (entity === "rv" && verb === "hd") { result = await setReviewStatusCore(reviewerId, id, "hidden"); actionLabel = "Review hidden"; positive = false; }
  else if (entity === "sg" && verb === "dn") { result = await setSuggestionStatusCore(reviewerId, id, "done"); actionLabel = "Suggestion marked done"; }
  else {
    await answer("Unknown action.");
    return;
  }

  if ("error" in result) {
    await answer(result.error, true);
    return;
  }

  await answer(`${actionLabel} ✅`);

  try {
    revalidatePath("/admin/queue");
    revalidatePath("/admin/reviews");
    revalidatePath("/admin/suggestions");
    revalidatePath("/admin");
  } catch { /* fine outside render context */ }

  // Remove the buttons from the original notification and record who acted.
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  await tgApi("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
  const who = [cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(" ") || cb.from?.username || "an admin";
  const icon = positive ? "✅" : "❌";
  await sendTelegram(
    `${icon} <b>${tgEsc(actionLabel)}</b>${result.label ? ` — ${tgEsc(result.label)}` : ""}\nBy ${tgEsc(who)}`,
    { replyTo: messageId, silent: true },
  );
}

// ---------------------------------------------------------------------------
// Messages: photos (poster upload) + commands
// ---------------------------------------------------------------------------

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function handleMessage(msg: any) {
  const chatId = msg.chat?.id;
  const text: string = msg.text ?? msg.caption ?? "";

  // Command parsing with @-addressing: "/pending@TheBuzzKidsBot" runs here,
  // "/pending@TheBuzzGuideBot" is the sibling bot's — ignore it.
  const rawCmd = text.trim().split(/\s+/)[0] ?? "";
  const atMatch = rawCmd.match(/^(\/[a-z_]+)@([A-Za-z0-9_]+)$/i);
  let command = rawCmd.toLowerCase();
  if (atMatch) {
    const ourName = await tgBotUsername();
    if (ourName && atMatch[2].toLowerCase() !== ourName.toLowerCase()) return;
    command = atMatch[1].toLowerCase();
  }

  // Bootstrap commands work from ANY chat — needed to discover the group's
  // chat id before TELEGRAM_CHAT_ID is configured.
  if (command === "/chatid" || command === "/start") {
    await sendTelegram(
      `This chat's id is <code>${chatId}</code>\n` +
      `Set it as <code>TELEGRAM_CHAT_ID</code> in Vercel to make this the admins group.`,
      { chatId, replyTo: msg.message_id },
    );
    return;
  }

  if (!isAdminChat(chatId)) return;

  // Photo (or image sent as file) → set an event poster.
  const photoFileId = pickPhotoFileId(msg);
  if (photoFileId) {
    await handlePosterUpload(msg, photoFileId);
    return;
  }

  if (command === "/help") {
    await sendHelp();
    return;
  }

  // Compact quick-action card. Both bots answer a bare /menu, so the group
  // gets one card per site — tap the site + action you want. Pin them!
  if (command === "/menu") {
    await sendMenuCard();
    return;
  }
  if (command === "/pending") {
    await handlePendingCommand();
    return;
  }
  if (command === "/stats") {
    await handleStatsCommand();
    return;
  }
}

async function sendHelp() {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.thebuzzkids.co.uk";
  await sendTelegram(
    `<b>The Buzz Kids admin bot</b>\n\n` +
    `I post what happens on The Buzz Kids: signups, new events from the website/aggregator pulls, ` +
    `edit suggestions and new-place leads, reviews, deal suggestions, messages. ` +
    `Pending items come with one-tap buttons.\n\n` +
    `<b>Set an event poster</b> — reply to one of MY event notifications with a photo, ` +
    `or send a photo with the event id in the caption.`,
    {
      buttons: [
        [
          { text: "📥 Pending", callback_data: "cmd:pending" },
          { text: "📊 Today's stats", callback_data: "cmd:stats" },
        ],
        [{ text: "🔍 Open admin queue", url: `${site}/admin/queue` }],
      ],
    },
  );
}

async function sendMenuCard() {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.thebuzzkids.co.uk";
  await sendTelegram(
    `🧒 <b>The Buzz Kids</b> — quick actions`,
    {
      silent: true,
      buttons: [
        [
          { text: "📥 Pending", callback_data: "cmd:pending" },
          { text: "📊 Stats", callback_data: "cmd:stats" },
        ],
        [{ text: "🔍 Admin queue", url: `${site}/admin/queue` }],
      ],
    },
  );
}

function pickPhotoFileId(msg: any): string | null {
  if (Array.isArray(msg.photo) && msg.photo.length > 0) {
    return msg.photo[msg.photo.length - 1].file_id ?? null;
  }
  if (msg.document && typeof msg.document.mime_type === "string" && msg.document.mime_type.startsWith("image/")) {
    return msg.document.file_id ?? null;
  }
  return null;
}

async function handlePosterUpload(msg: any, fileId: string) {
  const reply = (text: string) => sendTelegram(text, { replyTo: msg.message_id });

  // Shared-group etiquette: only claim a photo when it's replying to THIS
  // bot's message, or its caption carries an event id we actually have.
  const repliedToUs = msg.reply_to_message?.from?.id != null && msg.reply_to_message.from.id === tgBotId();
  const caption: string = msg.caption ?? "";
  const repliedText: string = msg.reply_to_message?.text ?? msg.reply_to_message?.caption ?? "";
  const eventId =
    caption.match(UUID_RE)?.[0] ??
    (repliedToUs ? repliedText.match(UUID_RE)?.[0] ?? null : null);

  if (!eventId) {
    if (repliedToUs) {
      await reply(
        "🖼 I got a photo but can't tell which event it's for.\n" +
        "Reply to an event notification with the photo, or put the event id in the caption.",
      );
    }
    return;
  }

  const sb = createServiceClient();
  const { data: event } = await sb
    .from("events")
    .select("id, title, venue:venues(name, slug, city:cities(slug))")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) {
    // A caption id we don't recognise is probably the sibling site's event —
    // stay quiet unless the photo was explicitly aimed at this bot.
    if (repliedToUs) await reply(`❌ No Buzz Kids event found with id <code>${eventId}</code>.`);
    return;
  }

  const file = await tgApi("getFile", { file_id: fileId });
  if (!file?.file_path) {
    await reply("❌ Couldn't download the photo from Telegram — try again.");
    return;
  }
  const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

  const result = await uploadPosterFromUrl(sb, { sourceUrl: fileUrl, eventId });
  if ("error" in result) {
    await reply(`❌ Poster upload failed: ${tgEsc(result.error)}`);
    return;
  }

  const { error: updateErr } = await sb
    .from("events")
    .update({ image_url: result.publicUrl })
    .eq("id", eventId);
  if (updateErr) {
    await reply(`❌ Uploaded but couldn't save to the event: ${tgEsc(updateErr.message)}`);
    return;
  }

  const venue = event.venue as any;
  const citySlug = venue?.city?.slug ?? "dundee";
  try {
    revalidatePath(`/${citySlug}/events/${eventId}`);
    if (venue?.slug) revalidatePath(`/${citySlug}/venues/${venue.slug}`);
    revalidatePath(`/${citySlug}`);
  } catch { /* fine outside render context */ }

  await reply(
    `🖼 Poster set for <b>${tgEsc(event.title)}</b>` +
    (venue?.name ? ` at ${tgEsc(venue.name)}` : "") +
    (result.trimmed ? "\n(cropped the solid borders off)" : ""),
  );
}

async function handlePendingCommand() {
  const sb = createServiceClient();
  const count = async (table: string, filter: (q: any) => any) => {
    const { count: n } = await filter(sb.from(table).select("id", { count: "exact", head: true }));
    return n ?? 0;
  };

  const [events, suggestions, places, reviews] = await Promise.all([
    count("events", (q) => q.eq("status", "pending")),
    count("edit_suggestions", (q) => q.eq("status", "new")),
    count("aggregator_places", (q) => q.eq("status", "new")),
    count("reviews", (q) => q.eq("status", "pending")),
  ]);

  const total = events + suggestions + places + reviews;
  if (total === 0) {
    await sendTelegram("✨ Buzz Kids queue is empty — nothing pending.");
    return;
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.thebuzzkids.co.uk";
  await sendTelegram(
    `📥 <b>Buzz Kids — pending review</b>\n` +
    `Events: ${events} · Edit suggestions: ${suggestions}\n` +
    `Places to add: ${places} · Reviews: ${reviews}`,
    { buttons: [[{ text: "🔍 Open admin queue", url: `${site}/admin/queue` }]] },
  );
  await sendPendingEventButtons(5);
}

async function handleStatsCommand() {
  const sb = createServiceClient();
  const now = new Date();
  const ukNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/London" }));
  const startOfDay = new Date(now.getTime() - (ukNow.getHours() * 3600 + ukNow.getMinutes() * 60 + ukNow.getSeconds()) * 1000).toISOString();

  const count = async (table: string, filter: (q: any) => any) => {
    const { count: n } = await filter(sb.from(table).select("id", { count: "exact", head: true }));
    return n ?? 0;
  };

  const [signups, eventsAdded, pending, reviewsToday, todaySignups] = await Promise.all([
    count("profiles", (q) => q.gte("created_at", startOfDay)),
    count("events", (q) => q.gte("created_at", startOfDay)),
    count("events", (q) => q.eq("status", "pending")),
    count("reviews", (q) => q.gte("created_at", startOfDay)),
    sb
      .from("profiles")
      .select("display_name, email, role")
      .gte("created_at", startOfDay)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => data ?? []),
  ]);

  const roleLabel = (r: string | null) =>
    r === "venue_owner" ? "business"
    : r === "organiser" ? "organiser"
    : r === "editor" ? "editor"
    : r === "admin" ? "admin"
    : "parent";
  const signupLines = todaySignups
    .map((p: any) => `  • ${tgEsc(p.display_name ?? "—")} · ${tgEsc(p.email ?? "—")} (${tgEsc(roleLabel(p.role))})`)
    .join("\n");

  await sendTelegram(
    `📊 <b>Buzz Kids — today so far</b>\n` +
    `New signups: ${signups}\n` +
    (signupLines ? `${signupLines}\n` : "") +
    (signups > 10 ? `  …and ${signups - 10} more\n` : "") +
    `Events added: ${eventsAdded}\n` +
    `Reviews left: ${reviewsToday}\n` +
    `Pending review: ${pending}`,
  );
}
