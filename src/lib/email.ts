// Tiny wrapper around Resend's REST API.
// We don't pull in the Resend SDK to avoid an extra dependency — this is one fetch call.
//
// Required env vars (set in Vercel Production + Preview, and in .env.local):
//   RESEND_API_KEY            re_xxxxxxxxxxxxxxxx
//   ADMIN_NOTIFY_EMAIL        admin@thebuzzguide.co.uk
//   ADMIN_NOTIFY_FROM         "The Buzz Guide <noreply@thebuzzguide.co.uk>"
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
  const from = process.env.ADMIN_NOTIFY_FROM ?? "The Buzz Guide <noreply@thebuzzguide.co.uk>";
  const fallbackTo = process.env.ADMIN_NOTIFY_EMAIL ?? "admin@thebuzzguide.co.uk";
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

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.thebuzzguide.co.uk";

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
      { kind: "p", text: "An artist account just registered on The Buzz Guide." },
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
      { kind: "p", text: "Someone just created an account on The Buzz Guide. They'll go through the setup wizard next." },
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
    subject: `Venue suggestion: ${opts.venueName}`,
    preheader: `An artist submitted a gig at ${opts.venueName}.`,
    blocks: [
      { kind: "h", text: "Venue suggestion" },
      { kind: "p", text: "An artist submitted a gig at a venue that isn't on The Buzz Guide yet." },
      { kind: "kv", pairs: [
        ["Venue", opts.venueName],
        ["City", opts.cityName ?? "—"],
        ["Gig", opts.gigTitle ?? "—"],
        ["Submitted by", opts.submitterEmail ?? "—"],
        ["Their contact", opts.submitterContact ?? "—"],
      ]},
      { kind: "button", href: `${SITE}/admin/queue`, text: "Review suggestion" },
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
    subject: `Pending gig at ${opts.venueName}`,
    preheader: `${opts.gigTitle} needs the venue owner's approval.`,
    blocks: [
      { kind: "h", text: "New pending gig" },
      { kind: "p", text: "An artist submitted a gig that needs the venue owner's approval." },
      { kind: "kv", pairs: [
        ["Venue", opts.venueName],
        ["Venue owner", opts.venueOwnerEmail ?? "—"],
        ["Gig", opts.gigTitle],
        ["When", opts.startTime ?? "—"],
        ["Submitted by", opts.submitterEmail ?? "—"],
      ]},
      { kind: "button", href: `${SITE}/dashboard/venues/${opts.venueId}`, text: "Open venue dashboard" },
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
    subject: `You're now the owner of ${opts.venueName} on The Buzz Guide`,
    preheader: `Your claim on ${opts.venueName} has been approved.`,
    blocks: [
      { kind: "h", text: "Claim approved" },
      { kind: "p", text: `Good news — your claim on ${opts.venueName} has been approved.` },
      { kind: "p", text: "You can now manage gigs, photos and venue details from your dashboard." },
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
      { kind: "p", text: `Thanks for your interest in claiming ${opts.venueName} on The Buzz Guide.` },
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
      { kind: "p", text: "Someone wants to claim an artist page on The Buzz Guide." },
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
    subject: `You're now the owner of ${opts.artistName} on The Buzz Guide`,
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
      { kind: "p", text: `Thanks for your interest in claiming ${opts.artistName} on The Buzz Guide.` },
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
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL ?? "admin@thebuzzguide.co.uk";
  return sendBrandedEmail({
    to: opts.venueOwnerEmail,
    replyTo: adminEmail,
    subject: `Approve a gig at ${opts.venueName}`,
    preheader: `${opts.gigTitle} is waiting for your approval.`,
    blocks: [
      { kind: "h", text: "Gig waiting for approval" },
      { kind: "p", text: `An artist has submitted a gig at ${opts.venueName} for your approval.` },
      { kind: "kv", pairs: [
        ["Gig", opts.gigTitle],
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
        ? `New gig: ${opts.items[0].title} at ${opts.items[0].venueName}`
        : `${count} new gigs from venues & artists you follow`,
    preheader: `Picked just for you on The Buzz Guide — ${count} new ${count === 1 ? "gig" : "gigs"}.`,
    blocks: [
      { kind: "h", text: count === 1 ? "New gig from your favourites" : `${count} new gigs from your favourites` },
      { kind: "p", text: `Hey${opts.displayName ? ` ${opts.displayName}` : ""} — just letting you know about ${count === 1 ? "a gig that's" : "some gigs that are"} just been added to The Buzz Guide from venues, artists or organisers you follow.` },
      { kind: "kv", pairs },
      { kind: "button", href: `${SITE}/dashboard/favourites`, text: "Open my favourites" },
      { kind: "small", text: "You're getting this because you saved at least one venue, artist or organiser on The Buzz Guide. Manage which alerts you receive in your dashboard." },
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
        ? `Tonight: ${opts.items[0].title}`
        : `${count} gigs you saved happen today`,
    preheader: `${count} ${count === 1 ? "gig" : "gigs"} from your favourites today.`,
    blocks: [
      { kind: "h", text: count === 1 ? "Your saved gig is today" : "Your saved gigs today" },
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
      { kind: "p", text: `Hey${name} — welcome to The Buzz Guide! ${variant.intro}` },
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
        subject: "Welcome to The Buzz Guide — let's get your venue live",
        heading: "Welcome — let's get you set up",
        preheader: "Claim your venue and start adding gigs in a couple of clicks.",
        intro:
          "You're signed up as a venue. From your dashboard you can claim your page, add gigs, upload posters and reach more music fans.",
        bullets: [
          ["🐝 Claim your venue", "Find your venue in the directory and take ownership"],
          ["🎤 Add events", "Quick form, AI poster import, or paste-in fixtures for sport"],
          ["📊 See views", "Track how many fans open your page and click your links"],
          ["♡ Get followed", "Fans who heart you get emailed about every new gig"],
        ],
        ctaHref: "/dashboard",
        ctaText: "Open my dashboard",
      };
    case "artist":
      return {
        subject: "Welcome to The Buzz Guide — let's get your band found",
        heading: "Welcome — let's get you on the map",
        preheader: "Claim your artist page and start adding gigs.",
        intro:
          "You're signed up as an artist. Claim your page so it shows up properly on venue pages and search, then add the gigs you've got booked.",
        bullets: [
          ["🎤 Claim your page", "Find your band in the directory and take ownership"],
          ["🎵 Add upcoming gigs", "Tag the venue and we'll cross-link automatically"],
          ["🔗 Link your socials", "Spotify, Instagram, Bandcamp — the lot"],
          ["♡ Get followed", "Fans who heart you get emailed every time you announce a gig"],
        ],
        ctaHref: "/dashboard",
        ctaText: "Open my dashboard",
      };
    case "organiser":
      return {
        subject: "Welcome to The Buzz Guide — let's get your events live",
        heading: "Welcome — let's get you set up",
        preheader: "Claim your organiser page and add events across multiple venues.",
        intro:
          "You're signed up as an event organiser. From your dashboard you can claim your page, add events at any venue on the site and grow your following.",
        bullets: [
          ["📋 Claim your page", "Find your organisation in the directory and take ownership"],
          ["🎵 Add events", "Pick any venue — events appear on theirs + yours"],
          ["🔗 Link your socials", "Tickets, Facebook event pages, your own site"],
          ["♡ Get followed", "Fans who heart you get notified about every new event"],
        ],
        ctaHref: "/dashboard",
        ctaText: "Open my dashboard",
      };
    default:
      // "user" / "fan" / anything else — treat as fan.
      return {
        subject: "Welcome to The Buzz Guide 👋",
        heading: "Welcome to The Buzz Guide",
        preheader: "Save your favourite venues and never miss a gig.",
        intro:
          "Thanks for signing up. The Buzz Guide is the local guide to live music & nights out across Dundee + Angus. Here's how to get the most out of it:",
        bullets: [
          ["♡ Heart what you like", "Save venues, bands and organisers you want to follow"],
          ["📩 Get the emails you want", "We'll ping you when your favourites announce a gig"],
          ["📍 Day planner", "Build a route through a festival or busy gig night"],
          ["🔍 Browse what's on", "Pubs, festivals, comedy, quizzes, live sport — all in one place"],
        ],
        ctaHref: "/",
        ctaText: "Browse what's on",
      };
  }
}
