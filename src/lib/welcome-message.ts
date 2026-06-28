// Insert a welcome message into the user's in-app message thread when
// admin approves their venue / artist / organiser. The user sees it
// next time they open /dashboard/messages, and can reply directly —
// turns approval into an open support channel rather than a one-shot
// email.
//
// Callers are already running in admin context (queue / admin actions),
// so this helper assumes auth has been checked upstream and just writes
// the row via the service client.

import { createServiceClient } from "@/lib/supabase/service";

type WelcomeKind = "venue" | "artist" | "organiser";

function buildWelcomeBody(kind: WelcomeKind, displayName: string): string {
  switch (kind) {
    case "venue":
      return `Welcome aboard! 🐝

${displayName} is now live on The Buzz Guide — you're all set up. From your dashboard you can add events, update opening hours, upload photos and respond to gig requests from artists.

📸 Quickest way to add a gig: hit "Upload poster", drop the image in, and our AI reads the title, date, time and price straight off the poster — you just review and approve. Way faster than typing the details in by hand.

Any questions, or anything that doesn't look right, just reply to this message and we'll come back to you. Thanks for joining.`;
    case "artist":
      return `Welcome to The Buzz Guide! 🎤

${displayName} is now live — fans can find your page, and any future gigs tagged with your name will automatically appear here. You can edit your bio, photo and socials anytime from your dashboard.

Any questions, just reply to this message and we'll come back to you. Thanks for being on board.`;
    case "organiser":
      return `Welcome aboard! 📋

${displayName} is now live on The Buzz Guide. From your dashboard you can manage events, update your profile and link past + future shows to your page.

Any questions, just reply to this message and we'll come back to you. Thanks for joining.`;
  }
}

/**
 * Fire-and-forget welcome message. Never throws — failure to send the
 * message shouldn't roll back the approval itself.
 */
export async function sendApprovalWelcomeMessage(opts: {
  userId: string;
  kind: WelcomeKind;
  displayName: string;
}): Promise<void> {
  try {
    const sb = createServiceClient();
    await sb.from("messages").insert({
      user_id: opts.userId,
      from_admin: true,
      body: buildWelcomeBody(opts.kind, opts.displayName),
    });
  } catch {
    // Best-effort — log on the server, never propagate.
  }
}
