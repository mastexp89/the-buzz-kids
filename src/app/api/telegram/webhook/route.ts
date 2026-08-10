import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { tgApi, sendTelegram, tgEsc, tgDate, tgBotId, tgBotUsername } from "@/lib/telegram";
import {
  resolveDefaultReviewerId,
  approveEventCore,
  rejectEventCore,
  approveArtistCore,
  approveVenueCore,
  approveOrganiserCore,
  approveVenueWithGigsCore,
  discardImportedVenueCore,
  reassignImportedEventsCore,
  setReviewStatusCore,
  setSuggestionStatusCore,
} from "@/lib/moderation";
import { sendAdminReplyToUser } from "@/lib/admin-reply";
import { importEventPoster, findVenueCandidates } from "@/lib/telegram-event-import";
import { tgNewGig } from "@/lib/telegram";
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
    else if (cmd === "menu") await sendMenuCard();
    return;
  }

  // "Did you mean…?" — move a poster import's events onto an existing
  // place. Candidates are recomputed from the imported place's name
  // (deterministic ordering), so the callback carries index + venue id.
  const vmMatch = data.match(/^vm:(\d+):([0-9a-f-]{36})$/i);
  if (vmMatch) {
    const reviewerId = await resolveDefaultReviewerId();
    if (!reviewerId) {
      await answer("No admin profile found.", true);
      return;
    }
    const sb = createServiceClient();
    const { data: iv } = await sb.from("venues").select("name").eq("id", vmMatch[2]).maybeSingle();
    if (!iv) {
      await answer("Already handled.", true);
      return;
    }
    const cands = await findVenueCandidates(iv.name);
    const target = cands[Number(vmMatch[1])];
    if (!target) {
      await answer("Couldn't resolve that option — use the admin queue.", true);
      return;
    }
    const res = await reassignImportedEventsCore(reviewerId, vmMatch[2], target.id);
    if ("error" in res) {
      await answer(res.error, true);
      return;
    }
    await answer(`Moved to ${target.name} ✅`.slice(0, 190));
    await tgApi("editMessageReplyMarkup", {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      reply_markup: { inline_keyboard: [] },
    });
    const mover = [cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(" ") || "an admin";
    await sendTelegram(
      `📦 Moved ${res.moved.length} event${res.moved.length === 1 ? "" : "s"} to <b>${tgEsc(res.targetName)}</b> (by ${tgEsc(mover)}) — approve below.`,
      { replyTo: cb.message.message_id, silent: true },
    );
    for (const ev of res.moved) {
      await tgNewGig({
        eventId: ev.id,
        title: ev.title,
        venueName: res.targetName,
        startTime: ev.start_time,
        byEmail: null,
        status: "pending",
        source: "poster import (place corrected)",
      });
    }
    try { revalidatePath("/admin/queue"); } catch { /* ok */ }
    return;
  }

  const m = data.match(/^(ev|ar|rv|sg|vn|og):(ap|rj|hd|dn|ok|del):([0-9a-f-]{36})$/i);
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
  else if (entity === "vn" && verb === "ap") { result = await approveVenueCore(reviewerId, id); actionLabel = "Place approved"; }
  else if (entity === "vn" && verb === "ok") { result = await approveVenueWithGigsCore(reviewerId, id); actionLabel = "Place + events approved"; }
  else if (entity === "vn" && verb === "del") { result = await discardImportedVenueCore(reviewerId, id); actionLabel = "Import discarded"; }
  else if (entity === "og" && verb === "ap") { result = await approveOrganiserCore(reviewerId, id); actionLabel = "Organiser approved"; }
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

  const isPrivate = msg.chat?.type === "private";

  // Bootstrap commands — /chatid anywhere, /start in groups — for
  // discovering a group's chat id during setup. /start in a PRIVATE chat is
  // the public organiser onboarding instead.
  if (command === "/chatid" || (command === "/start" && !isPrivate)) {
    await sendTelegram(
      `This chat's id is <code>${chatId}</code>\n` +
      `Set it as <code>TELEGRAM_CHAT_ID</code> in Vercel to make this the admins group.`,
      { chatId, replyTo: msg.message_id },
    );
    return;
  }

  if (!isAdminChat(chatId)) {
    // Public side: organisers can DM the bot an event poster — no need to
    // be anywhere near the admins group.
    if (isPrivate) await handlePublicDm(msg);
    return;
  }

  // Photo (or image sent as file): "/event" caption → AI-read the poster
  // and create the events; otherwise it sets an existing event's poster.
  const photoFileId = pickPhotoFileId(msg);
  if (photoFileId) {
    if (command === "/event") {
      await handleEventSubmission(msg, photoFileId, { fromAdminGroup: true });
      return;
    }
    await handlePosterUpload(msg, photoFileId);
    return;
  }
  if (command === "/event") {
    await sendTelegram(
      "📸 Attach a poster photo with <code>/event</code> as the caption and I'll read it, " +
      "work out the place, and post the events here for approval.",
      { replyTo: msg.message_id },
    );
    return;
  }

  // Plain-text reply to one of OUR "New message from a user" notifications
  // → send it into that user's in-app thread (email + push included).
  if (msg.text && !command.startsWith("/")) {
    const repliedToUs = msg.reply_to_message?.from?.id != null && msg.reply_to_message.from.id === tgBotId();
    const repliedText: string = msg.reply_to_message?.text ?? "";
    const userIdMatch = repliedToUs ? repliedText.match(/User ID:\s*([0-9a-f-]{36})/i) : null;
    if (userIdMatch) {
      const result = await sendAdminReplyToUser(userIdMatch[1], msg.text);
      if ("error" in result) {
        await sendTelegram(`❌ Couldn't send: ${tgEsc(result.error)}`, { replyTo: msg.message_id });
      } else {
        const who = result.displayName ?? result.email ?? "the user";
        await sendTelegram(
          `↩️ Sent to <b>${tgEsc(who)}</b> — they'll see it in their dashboard thread` +
          (result.email ? " plus an email" : "") + ".",
          { replyTo: msg.message_id, silent: true },
        );
      }
      return;
    }
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
    `or send a photo with the event id in the caption.\n\n` +
    `<b>Add events from a poster</b> — send a photo captioned <code>/event</code> and I'll read it, ` +
    `find (or create) the place, and post the events here for approval. ` +
    `Organisers can also DM me posters directly — no group access needed.`,
    {
      buttons: [
        [
          { text: "📥 Pending", callback_data: "cmd:pending" },
          { text: "📊 Today's stats", callback_data: "cmd:stats" },
        ],
        [
          { text: "🔍 Open admin queue", url: `${site}/admin/queue` },
          { text: "⬅️ Menu", callback_data: "cmd:menu" },
        ],
      ],
    },
  );
}

// ---------------------------------------------------------------------------
// Public DM side — organisers sending event posters straight to the bot
// ---------------------------------------------------------------------------

async function handlePublicDm(msg: any) {
  const photoFileId = pickPhotoFileId(msg);
  if (photoFileId) {
    await handleEventSubmission(msg, photoFileId, { fromAdminGroup: false });
    return;
  }
  await sendTelegram(
    `👋 <b>Hi — I'm The Buzz Kids event bot.</b>\n\n` +
    `Send me an event poster as a photo — fun days, fetes, holiday clubs, shows — ` +
    `and I'll read it and send the events to thebuzzkids.co.uk for review.\n\n` +
    `📸 If the venue or park name is on the poster I'll find it automatically — otherwise ` +
    `write the place name in the photo's caption.`,
    { chatId: msg.chat.id },
  );
}

/** Shared "/event" pipeline: admin group uploads and public DMs. */
async function handleEventSubmission(
  msg: any,
  fileId: string,
  opts: { fromAdminGroup: boolean },
) {
  const chatId = msg.chat.id;
  const reply = (text: string) => sendTelegram(text, { chatId, replyTo: msg.message_id });

  const file = await tgApi("getFile", { file_id: fileId });
  if (!file?.file_path) {
    await reply("❌ Couldn't download the photo from Telegram — try again.");
    return;
  }
  const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

  const reviewerId = await resolveDefaultReviewerId();
  if (!reviewerId) {
    await reply("❌ Site configuration problem (no admin account) — tell the team.");
    return;
  }

  await reply("🤖 Reading the poster… this usually takes about 20 seconds.");

  const result = await importEventPoster({
    imageUrl: fileUrl,
    submittedBy: reviewerId,
    venueHintOverride: msg.caption ?? null,
  });

  if (!result.ok) {
    if (result.reason === "no_events") {
      await reply("🤔 I couldn't find any upcoming events on that image. Make sure it's an event poster with dates on it.");
    } else if (result.reason === "no_venue_hint") {
      await reply("🤔 I read the poster but couldn't see where it's happening. Send it again with the place name written in the photo caption.");
    } else {
      await reply("❌ The poster reader is unavailable right now — please try again later.");
    }
    return;
  }

  const lines = result.created
    .map((c) => `  • ${tgEsc(c.title)} — ${tgEsc(tgDate(c.startTime))}`)
    .join("\n");
  const dupNote = result.skippedDuplicates.length
    ? `\n(${result.skippedDuplicates.length} already listed, skipped)`
    : "";

  if (result.created.length === 0) {
    await reply(`👍 Those events are already listed at <b>${tgEsc(result.venueName)}</b> — nothing new to add.${dupNote}`);
    return;
  }

  const senderName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || "someone";
  const senderLabel = opts.fromAdminGroup
    ? "poster upload in this group"
    : `Telegram DM from ${senderName}${msg.from?.username ? ` (@${msg.from.username})` : ""}`;

  if (result.createdVenue) {
    await reply(
      `🆕 <b>${tgEsc(result.venueName)}</b> isn't on The Buzz Kids yet, so I've added it along with:\n${lines}${dupNote}\n` +
      (opts.fromAdminGroup ? "Approve or discard below." : "The Buzz Kids team will review it shortly."),
    );
    await sendTelegram(
      `🆕 <b>New place from a poster</b> — ${tgEsc(result.venueName)}\n` +
      `📍 Region: ${tgEsc(result.citySlug ?? "—")}${result.citySure ? "" : " ⚠️ (guessed — double-check in admin before approving)"}\n` +
      `${lines}\n` +
      `Via ${tgEsc(senderLabel)}\n` +
      `Approving publishes the place AND the event${result.created.length === 1 ? "" : "s"}; discarding deletes both.`,
      {
        buttons: [
          [
            { text: "✅ Approve place + events", callback_data: `vn:ok:${result.venueId}` },
            { text: "🗑 Discard", callback_data: `vn:del:${result.venueId}` },
          ],
          // "Did you mean…?" — one tap moves the events onto an existing
          // place instead and bins the auto-created one.
          ...result.candidates.map((c, i) => [
            { text: `📍 It's ${c.name.slice(0, 40)}`, callback_data: `vm:${i}:${result.venueId}` },
          ]),
        ],
      },
    );
    return;
  }

  await reply(
    `📨 <b>Sent for review</b> — ${result.created.length} event${result.created.length === 1 ? "" : "s"} at ${tgEsc(result.venueName)}:\n${lines}${dupNote}\n` +
    `The Buzz Kids team will approve ${result.created.length === 1 ? "it" : "them"} shortly.`,
  );

  for (const c of result.created) {
    await tgNewGig({
      eventId: c.id,
      title: c.title,
      venueName: result.venueName,
      startTime: c.startTime,
      byEmail: null,
      status: "pending",
      source: senderLabel,
    });
  }
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
    await sendTelegram("✨ Buzz Kids queue is empty — nothing pending.", {
      buttons: [[{ text: "⬅️ Menu", callback_data: "cmd:menu" }]],
    });
    return;
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.thebuzzkids.co.uk";
  await sendTelegram(
    `📥 <b>Buzz Kids — pending review</b>\n` +
    `Events: ${events} · Edit suggestions: ${suggestions}\n` +
    `Places to add: ${places} · Reviews: ${reviews}`,
    {
      buttons: [[
        { text: "🔍 Open admin queue", url: `${site}/admin/queue` },
        { text: "⬅️ Menu", callback_data: "cmd:menu" },
      ]],
    },
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
    { buttons: [[{ text: "⬅️ Menu", callback_data: "cmd:menu" }]] },
  );
}
