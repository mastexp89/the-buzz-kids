// Tiny wrapper around Resend's REST API.
// We don't pull in the Resend SDK to avoid an extra dependency — this is one fetch call.
//
// Required env vars (set in Vercel Production + Preview, and in .env.local):
//   RESEND_API_KEY            re_xxxxxxxxxxxxxxxx
//   ADMIN_NOTIFY_EMAIL        hello@thebuzzkids.co.uk
//   ADMIN_NOTIFY_FROM         "The Buzz Kids <noreply@thebuzzkids.co.uk>"
//
// All sends are best-effort — if Resend fails we log + return false, never throw.

import { buildEmailHtml, buildEmailText, type EmailBlock } from "./email-template";

type SendArgs = {
  subject: string;
  text: string;
  html?: string;
  to?: string;        // defaults to ADMIN_NOTIFY_EMAIL
  replyTo?: string;   // optional reply-to header
};

export async function sendAdminEmail({ subject, text, html, to, replyTo }: SendArgs): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ADMIN_NOTIFY_FROM ?? "The Buzz Kids <noreply@thebuzzkids.co.uk>";
  const fallbackTo = process.env.ADMIN_NOTIFY_EMAIL ?? "hello@thebuzzkids.co.uk";
  const recipient = to ?? fallbackTo;

  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY missing, skipping email:", subject);
    return false;
  }

  try {
    const body: any = {
      from,
      to: [recipient],
      subject,
      text,
      html: html ?? `<pre style="font-family:system-ui,sans-serif;font-size:14px;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
    };
    if (replyTo) body.reply_to = replyTo;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn("[email] resend non-200:", res.status, errBody);
      return false;
    }
    return true;
  } catch (e: any) {
    console.warn("[email] send failed:", e?.message ?? e);
    return false;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Send a branded HTML email built from typed blocks. Plain-text body is
 * generated automatically from the same blocks for fallback / spam filters.
 */
async function sendBrandedEmail(opts: {
  subject: string;
  blocks: EmailBlock[];
  preheader?: string;
  to?: string;
  replyTo?: string;
}): Promise<boolean> {
  const html = buildEmailHtml({ preheader: opts.preheader, blocks: opts.blocks });
  const text = buildEmailText(opts.blocks);
  return sendAdminEmail({
    subject: opts.subject,
    text,
    html,
    to: opts.to,
    replyTo: opts.replyTo,
  });
}

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.thebuzzkids.co.uk";

export function notifyNewVenue(opts: {
  venueId: string;
  venueName: string;
  ownerEmail: string | null;
  cityName: string | null;
}) {
  return sendBrandedEmail({
    subject: `New venue pending: ${opts.venueName}`,
    preheader: `${opts.venueName} (${opts.cityName ?? "—"}) is waiting for approval.`,
    blocks: [
      { kind: "h", text: "New venue pending approval" },
      { kind: "p", text: "A new venue has signed up and is waiting to be approved." },
      { kind: "kv", pairs: [
        ["Venue", opts.venueName],
        ["City", opts.cityName ?? "—"],
        ["Owner", opts.ownerEmail ?? "—"],
      ]},
      { kind: "button", href: `${SITE}/admin/queue`, text: "Open admin queue" },
    ],
  });
}

export function notifyNewArtist(opts: {
  artistId: string;
  artistName: string;
  claimerEmail: string | null;
}) {
  return sendBrandedEmail({
    subject: `New artist registered: ${opts.artistName}`,
    preheader: `${opts.artistName} just registered.`,
    blocks: [
      { kind: "h", text: "New artist registered" },
      { kind: "p", text: "An artist account just registered on The Buzz Kids." },
      { kind: "kv", pairs: [
        ["Artist", opts.artistName],
        ["Registered by", opts.claimerEmail ?? "—"],
      ]},
      { kind: "button", href: `${SITE}/admin/queue`, text: "Open admin queue" },
    ],
  });
}

export function notifyNewOrganiser(opts: {
  organiserId: string;
  organiserName: string;
  claimerEmail: string | null;
}) {
  return sendBrandedEmail({
    subject: `New organiser pending: ${opts.organiserName}`,
    preheader: `${opts.organiserName} is waiting for approval.`,
    blocks: [
      { kind: "h", text: "New organiser pending approval" },
      { kind: "p", text: "A new event organiser has signed up and is waiting to be approved." },
      { kind: "kv", pairs: [
        ["Organiser", opts.organiserName],
        ["Registered by", opts.claimerEmail ?? "—"],
      ]},
      { kind: "button", href: `${SITE}/admin/queue`, text: "Review in admin" },
    ],
  });
}

export function notifyNewSignup(opts: {
  displayName: string | null;
  email: string | null;
  accountType: "venue" | "artist" | "organiser" | string;
}) {
  const typeLabel =
    opts.accountType === "venue" ? "Venue"
    : opts.accountType === "artist" ? "Artist / Band / DJ"
    : opts.accountType === "organiser" ? "Event organiser"
    : opts.accountType;
  return sendBrandedEmail({
    subject: `New signup: ${opts.displayName ?? opts.email ?? "(no name)"} — ${typeLabel}`,
    preheader: `A new ${typeLabel.toLowerCase()} account just signed up.`,
    blocks: [
      { kind: "h", text: "New account signup" },
      { kind: "p", text: "Someone just created an account on The Buzz Kids. They'll go through the setup wizard next." },
      { kind: "kv", pairs: [
        ["Name", opts.displayName ?? "—"],
        ["Email", opts.email ?? "—"],
        ["Account type", typeLabel],
      ]},
      { kind: "button", href: `${SITE}/admin`, text: "Open admin" },
    ],
  });
}

export function notifyVenueSuggestion(opts: {
  venueName: string;
  cityName: string | null;
  gigTitle: string | null;
  submitterEmail: string | null;
  submitterContact: string | null;
}) {
  return sendBrandedEmail({
    subject: `Place suggestion: ${opts.venueName}`,
    preheader: `Someone submitted an event at ${opts.venueName}.`,
    blocks: [
      { kind: "h", text: "Place suggestion" },
      { kind: "p", text: "Someone submitted an event at a place that isn't on The Buzz Kids yet." },
      { kind: "kv", pairs: [
        ["Place", opts.venueName],
        ["Area", opts.cityName ?? "—"],
        ["Event", opts.gigTitle ?? "—"],
        ["Submitted by", opts.submitterEmail ?? "—"],
        ["Their contact", opts.submitterContact ?? "—"],
      ]},
      { kind: "button", href: `${SITE}/admin/queue`, text: "Review suggestion" },
    ],
  });
}

// A visitor (or a place owner) suggested an edit to a listing, or asked for
// a brand-new place to be added. Lands in the admin edit_suggestions queue;
// this just pings us so we notice. Reply-to is set to their contact email
// when they left one, so a reply reaches them directly.
export function notifyEditSuggestion(opts: {
  target_type: string;
  target_name: string | null;
  reason: string | null;
  details: string | null;
  contact_name: string | null;
  contact_email: string | null;
  is_owner: boolean;
}) {
  const kindLabel =
    opts.target_type === "new_place" ? "New place request"
    : opts.target_type === "event" ? "Event edit suggestion"
    : "Place edit suggestion";
  return sendBrandedEmail({
    subject: `${kindLabel}: ${opts.target_name ?? "—"}`,
    preheader: `${opts.reason ?? "Someone suggested a change"}${opts.is_owner ? " — from the owner" : ""}.`,
    replyTo: opts.contact_email ?? undefined,
    blocks: [
      { kind: "h", text: kindLabel },
      { kind: "kv", pairs: [
        [opts.target_type === "new_place" ? "Place" : "Listing", opts.target_name ?? "—"],
        ["Reason", opts.reason ?? "—"],
        ["What they said", opts.details ?? "—"],
        ["From", opts.is_owner ? "Says they run this place/activity" : "A visitor"],
        ["Contact", [opts.contact_name, opts.contact_email].filter(Boolean).join(" · ") || "—"],
      ]},
      { kind: "button", href: `${SITE}/admin/suggestions`, text: "Review suggestions" },
    ],
  });
}

export function notifyPendingGig(opts: {
  venueName: string;
  venueOwnerEmail: string | null;
  gigTitle: string;
  startTime: string | null;
  submitterEmail: string | null;
  venueId: string;
}) {
  return sendBrandedEmail({
    subject: `Pending event at ${opts.venueName}`,
    preheader: `${opts.gigTitle} needs the place owner's approval.`,
    blocks: [
      { kind: "h", text: "New pending event" },
      { kind: "p", text: "Someone submitted an event that needs the place owner's approval." },
      { kind: "kv", pairs: [
        ["Place", opts.venueName],
        ["Place owner", opts.venueOwnerEmail ?? "—"],
        ["Event", opts.gigTitle],
        ["When", opts.startTime ?? "—"],
        ["Submitted by", opts.submitterEmail ?? "—"],
      ]},
      { kind: "button", href: `${SITE}/dashboard/venues/${opts.venueId}`, text: "Open place dashboard" },
    ],
  });
}

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  individual: "Individual (one place)",
  multiple: "Multiple attractions",
  agency: "Agency",
};

export function notifyVenueClaim(opts: {
  venueName: string;
  venueId: string;
  citySlug: string | null;
  venueSlug: string | null;
  claimantEmail: string | null;
  claimantName: string | null;
  role: string | null;
  businessName?: string | null;
  businessType?: string | null;
  contactPhone: string | null;
  reason: string | null;
}) {
  const venueLink = opts.citySlug && opts.venueSlug
    ? `${SITE}/${opts.citySlug}/venues/${opts.venueSlug}`
    : `${SITE}/admin`;
  const typeLabel = opts.businessType
    ? BUSINESS_TYPE_LABELS[opts.businessType] ?? opts.businessType
    : "—";
  return sendBrandedEmail({
    subject: `Ownership claim: ${opts.venueName}`,
    preheader: `${opts.claimantName ?? "Someone"} wants to claim ${opts.venueName}.`,
    replyTo: opts.claimantEmail ?? undefined,
    blocks: [
      { kind: "h", text: "New place ownership claim" },
      { kind: "p", text: "Someone wants to claim ownership of a place on The Buzz Kids." },
      { kind: "kv", pairs: [
        ["Place", opts.venueName],
        ["Page", venueLink],
        ["Claimant", `${opts.claimantName ?? "—"} (${opts.claimantEmail ?? "—"})`],
        ["Business", opts.businessName ?? "—"],
        ["Operator type", typeLabel],
        ["Phone", opts.contactPhone ?? "—"],
        ["Reason", opts.reason ?? "—"],
      ]},
      { kind: "button", href: `${SITE}/admin/queue`, text: "Review claim" },
    ],
  });
}

export function notifyClaimApproved(opts: {
  claimantEmail: string;
  venueName: string;
  citySlug: string;
  venueSlug: string;
  venueId: string;
}) {
  return sendBrandedEmail({
    to: opts.claimantEmail,
    subject: `You're now the owner of ${opts.venueName} on The Buzz Kids`,
    preheader: `Your claim on ${opts.venueName} has been approved.`,
    blocks: [
      { kind: "h", text: "Claim approved" },
      { kind: "p", text: `Good news — your claim on ${opts.venueName} has been approved.` },
      { kind: "p", text: "You can now manage events, photos and place details from your dashboard." },
      { kind: "button", href: `${SITE}/dashboard/venues/${opts.venueId}`, text: "Open my dashboard" },
      { kind: "small", text: `Public page: ${SITE}/${opts.citySlug}/venues/${opts.venueSlug}` },
      { kind: "small", text: "Any questions? Just reply to this email." },
    ],
  });
}

export function notifyClaimRejected(opts: {
  claimantEmail: string;
  venueName: string;
  reason: string | null;
}) {
  return sendBrandedEmail({
    to: opts.claimantEmail,
    subject: `Your claim on ${opts.venueName}`,
    preheader: `Update on your claim for ${opts.venueName}.`,
    blocks: [
      { kind: "h", text: "Claim update" },
      { kind: "p", text: `Thanks for your interest in claiming ${opts.venueName} on The Buzz Kids.` },
      { kind: "p", text: "We weren't able to approve this claim at the moment." },
      ...(opts.reason ? [{ kind: "kv" as const, pairs: [["Reason", opts.reason] as [string, string]] }] : []),
      { kind: "p", text: "If you think this was a mistake or you'd like to provide more info, just reply to this email and we'll take another look." },
    ],
  });
}

export function notifyArtistClaim(opts: {
  artistName: string;
  artistId: string;
  artistSlug: string | null;
  claimantEmail: string | null;
  claimantName: string | null;
  role: string | null;
  contactPhone: string | null;
  reason: string | null;
}) {
  const artistLink = opts.artistSlug
    ? `${SITE}/artists/${opts.artistSlug}`
    : `${SITE}/admin/queue`;
  return sendBrandedEmail({
    subject: `Artist claim: ${opts.artistName}`,
    preheader: `${opts.claimantName ?? "Someone"} wants to claim ${opts.artistName}.`,
    replyTo: opts.claimantEmail ?? undefined,
    blocks: [
      { kind: "h", text: "New artist ownership claim" },
      { kind: "p", text: "Someone wants to claim an artist page on The Buzz Kids." },
      { kind: "kv", pairs: [
        ["Artist", opts.artistName],
        ["Page", artistLink],
        ["Claimant", `${opts.claimantName ?? "—"} (${opts.claimantEmail ?? "—"})`],
        ["Role", opts.role ?? "—"],
        ["Phone", opts.contactPhone ?? "—"],
        ["Reason", opts.reason ?? "—"],
      ]},
      { kind: "button", href: `${SITE}/admin/queue`, text: "Review claim" },
    ],
  });
}

export function notifyArtistClaimApproved(opts: {
  claimantEmail: string;
  artistName: string;
  artistSlug: string;
  artistId: string;
}) {
  return sendBrandedEmail({
    to: opts.claimantEmail,
    subject: `You're now the owner of ${opts.artistName} on The Buzz Kids`,
    preheader: `Your claim on ${opts.artistName} has been approved.`,
    blocks: [
      { kind: "h", text: "Claim approved" },
      { kind: "p", text: `Your claim on ${opts.artistName} has been approved.` },
      { kind: "p", text: "You can now edit your bio, photo and socials, and any future gigs tagged to your name will show up automatically." },
      { kind: "button", href: `${SITE}/dashboard/artist/${opts.artistId}/edit`, text: "Edit my page" },
      { kind: "small", text: `Public page: ${SITE}/artists/${opts.artistSlug}` },
      { kind: "small", text: "Any questions? Just reply to this email." },
    ],
  });
}

export function notifyArtistClaimRejected(opts: {
  claimantEmail: string;
  artistName: string;
  reason: string | null;
}) {
  return sendBrandedEmail({
    to: opts.claimantEmail,
    subject: `Your claim on ${opts.artistName}`,
    preheader: `Update on your claim for ${opts.artistName}.`,
    blocks: [
      { kind: "h", text: "Claim update" },
      { kind: "p", text: `Thanks for your interest in claiming ${opts.artistName} on The Buzz Kids.` },
      { kind: "p", text: "We weren't able to approve this claim at the moment." },
      ...(opts.reason ? [{ kind: "kv" as const, pairs: [["Reason", opts.reason] as [string, string]] }] : []),
      { kind: "p", text: "If you think this was a mistake or you'd like to provide more info, reply to this email and we'll take another look." },
    ],
  });
}

export function notifyVenueOwnerOfPendingGig(opts: {
  venueOwnerEmail: string;
  venueName: string;
  gigTitle: string;
  startTime: string | null;
  venueId: string;
}) {
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL ?? "hello@thebuzzkids.co.uk";
  return sendBrandedEmail({
    to: opts.venueOwnerEmail,
    replyTo: adminEmail,
    subject: `Approve an event at ${opts.venueName}`,
    preheader: `${opts.gigTitle} is waiting for your approval.`,
    blocks: [
      { kind: "h", text: "Event waiting for approval" },
      { kind: "p", text: `Someone has submitted an event at ${opts.venueName} for your approval.` },
      { kind: "kv", pairs: [
        ["Event", opts.gigTitle],
        ["When", opts.startTime ?? "—"],
      ]},
      { kind: "button", href: `${SITE}/dashboard/venues/${opts.venueId}`, text: "Approve in dashboard" },
    ],
  });
}

// ===========================================================================
// FAN NOTIFICATIONS (Phase 2)
// ===========================================================================
// These email a regular user (a "fan") about gigs they've favourited or
// related to entities they follow. Always send to the user's own email,
// never to admin. Unsubscribe footer points at /dashboard/notifications.

type FollowedGigDigestItem = {
  title: string;
  when: string; // formatted by caller, e.g. "Fri 30 May · 8pm"
  venueName: string;
  citySlug: string;
  eventId: string;
  reason: "venue" | "artist" | "organiser" | "saved";
  reasonName: string; // the venue/artist/organiser name that triggered the notification
};

/**
 * "Some gigs you might like just got added" — digest of new gigs at
 * venues / artists / organisers the user follows. One email per
 * batch run (so a user with 3 new gigs at followed venues gets one
 * email with 3 items, not 3 separate emails).
 */
export function notifyFollowedGigsDigest(opts: {
  userEmail: string;
  displayName: string | null;
  items: FollowedGigDigestItem[];
}) {
  const count = opts.items.length;
  const pairs: Array<[string, string]> = opts.items.map((i) => [
    `${i.when} · ${i.venueName}`,
    `${i.title} — because you follow ${i.reasonName}`,
  ]);
  // Build a one-CTA email — link to the dashboard favourites page where
  // they can see everything. Per-item deep links would explode the
  // template; the heading + preview is enough to tempt the click.
  return sendBrandedEmail({
    to: opts.userEmail,
    subject:
      count === 1
        ? `New activity: ${opts.items[0].title} at ${opts.items[0].venueName}`
        : `${count} new activities from places you follow`,
    preheader: `Picked just for you on The Buzz Kids — ${count} new ${count === 1 ? "activity" : "activities"}.`,
    blocks: [
      { kind: "h", text: count === 1 ? "New activity from your favourites" : `${count} new activities from your favourites` },
      { kind: "p", text: `Hey${opts.displayName ? ` ${opts.displayName}` : ""} — just letting you know about ${count === 1 ? "an activity that's" : "some activities that have"} just been added to The Buzz Kids from places or organisers you follow.` },
      { kind: "kv", pairs },
      { kind: "button", href: `${SITE}/dashboard/favourites`, text: "Open my favourites" },
      { kind: "small", text: "You're getting this because you saved at least one place or organiser on The Buzz Kids. Manage which alerts you receive in your dashboard." },
    ],
  });
}

/**
 * Morning-of digest: "Here's what you saved for today." Fired by a
 * 08:00 UTC cron each morning, once per user per day, with every
 * upcoming favourited gig on that calendar day.
 */
export function notifyMorningOf(opts: {
  userEmail: string;
  displayName: string | null;
  items: Array<{
    title: string;
    when: string;
    venueName: string;
    citySlug: string;
    eventId: string;
  }>;
}) {
  const count = opts.items.length;
  const pairs: Array<[string, string]> = opts.items.map((i) => [
    i.when,
    `${i.title} — ${i.venueName}`,
  ]);
  return sendBrandedEmail({
    to: opts.userEmail,
    subject:
      count === 1
        ? `Today: ${opts.items[0].title}`
        : `${count} activities you saved are on today`,
    preheader: `${count} ${count === 1 ? "activity" : "activities"} from your favourites today.`,
    blocks: [
      { kind: "h", text: count === 1 ? "Your saved activity is today" : "Your saved activities today" },
      { kind: "p", text: `Morning${opts.displayName ? ` ${opts.displayName}` : ""} — here&apos;s what's on the cards from your favourites:` },
      { kind: "kv", pairs },
      { kind: "button", href: `${SITE}/dashboard/favourites?tab=events`, text: "Open today's plan" },
      { kind: "small", text: "Don't want these morning reminders? Toggle them off in /dashboard/notifications." },
    ],
  });
}

/**
 * 15-minute-before reminder: single gig only, fired by an every-5-min
 * cron when an event is starting in 13-17 minutes. Includes a Maps
 * link so the user can navigate to the venue from wherever they are.
 */
export function notifyFifteenMinutes(opts: {
  userEmail: string;
  title: string;
  venueName: string;
  venueAddress: string | null;
  citySlug: string;
  eventId: string;
}) {
  const mapsQuery = encodeURIComponent(
    [opts.venueName, opts.venueAddress].filter(Boolean).join(", "),
  );
  return sendBrandedEmail({
    to: opts.userEmail,
    subject: `🕒 Starting in 15 mins: ${opts.title}`,
    preheader: `${opts.title} at ${opts.venueName} kicks off in 15 minutes.`,
    blocks: [
      { kind: "h", text: "Starting in 15 minutes" },
      { kind: "p", text: `${opts.title} is on shortly at ${opts.venueName}.` },
      { kind: "button", href: `https://maps.google.com/?q=${mapsQuery}`, text: "📍 Open in Maps" },
      { kind: "small", text: `Event details: ${SITE}/${opts.citySlug}/events/${opts.eventId}` },
      { kind: "small", text: "Don't want 15-min reminders? Switch them off in /dashboard/notifications." },
    ],
  });
}

/**
 * Welcome email sent after a user clicks the Supabase email-confirmation
 * link. Copy is tailored by account type (fan / venue_owner / artist /
 * organiser) so each segment gets pointed at the right next step. Queued
 * by sql/044 trigger, drained by /api/cron/welcome-emails.
 */
export function notifyWelcome(opts: {
  email: string;
  displayName: string | null;
  accountType: string;
}) {
  const name = opts.displayName ? ` ${opts.displayName}` : "";
  const variant = welcomeVariantFor(opts.accountType);
  return sendBrandedEmail({
    to: opts.email,
    subject: variant.subject,
    preheader: variant.preheader,
    blocks: [
      { kind: "h", text: variant.heading },
      { kind: "p", text: `Hey${name} — welcome to The Buzz Kids! ${variant.intro}` },
      { kind: "kv", pairs: variant.bullets },
      { kind: "button", href: `${SITE}${variant.ctaHref}`, text: variant.ctaText },
      {
        kind: "small",
        text:
          "Reply to this email any time if you've got feedback, need help, or want to suggest a feature. We're a small team and we read every reply.",
      },
    ],
  });
}

type WelcomeVariant = {
  subject: string;
  heading: string;
  preheader: string;
  intro: string;
  bullets: Array<[string, string]>;
  ctaHref: string;
  ctaText: string;
};

function welcomeVariantFor(accountType: string): WelcomeVariant {
  switch (accountType) {
    case "venue_owner":
      return {
        subject: "Welcome to The Buzz Kids — let's get your place live",
        heading: "Welcome — let's get you set up",
        preheader: "Claim your place and start adding activities in a couple of clicks.",
        intro:
          "You're signed up as a place. From your dashboard you can claim your page, add activities and sessions, upload posters and reach more local families.",
        bullets: [
          ["🐝 Claim your place", "Find your place in the directory and take ownership"],
          ["🎟️ Add activities", "Quick form or AI poster import for classes, sessions & events"],
          ["📊 See views", "Track how many families open your page and click your links"],
          ["♡ Get followed", "Families who save you get emailed when you add something new"],
        ],
        ctaHref: "/dashboard",
        ctaText: "Open my dashboard",
      };
    case "organiser":
      return {
        subject: "Welcome to The Buzz Kids — let's get your activities live",
        heading: "Welcome — let's get you set up",
        preheader: "Claim your organiser page and add activities across multiple places.",
        intro:
          "You're signed up as an activity organiser. From your dashboard you can claim your page, add activities at any place on the site and grow your following.",
        bullets: [
          ["📋 Claim your page", "Find your organisation in the directory and take ownership"],
          ["🎟️ Add activities", "Pick any place — activities appear on theirs + yours"],
          ["🔗 Link your socials", "Tickets, Facebook event pages, your own site"],
          ["♡ Get followed", "Families who save you get notified about every new activity"],
        ],
        ctaHref: "/dashboard",
        ctaText: "Open my dashboard",
      };
    default:
      // "user" / "fan" / "parent" / anything else — treat as a parent.
      return {
        subject: "Welcome to The Buzz Kids 👋",
        heading: "Welcome to The Buzz Kids",
        preheader: "Save your favourite places and never miss a thing to do.",
        intro:
          "Thanks for signing up. The Buzz Kids is the free guide to kid-friendly things to do across Scotland. Here's how to get the most out of it:",
        bullets: [
          ["♡ Build your bucket list", "Save the places and activities you want to try"],
          ["📩 Get the emails you want", "We'll ping you when new sessions land for the holidays"],
          ["📍 Day planner", "Plan a route through a busy day out with the kids"],
          ["🔍 Browse what's on", "Soft play, farm parks, messy play, holiday clubs — all in one place"],
        ],
        ctaHref: "/",
        ctaText: "Browse what's on",
      };
  }
}
