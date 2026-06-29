import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/account/delete
 *
 * Permanently deletes the calling user's account and all of their data:
 *   - Their venues (and the venues' events / event_artists / event_genres)
 *   - Their artist row (if any)
 *   - Their profile row
 *   - Their auth.users record
 *
 * Stripe transaction records and historical event submissions to OTHER
 * venues are intentionally retained — see /delete-account for the user-
 * facing explanation of what we keep.
 *
 * Auth model:
 *   - Web callers send the request with the auth cookie (handled by
 *     createClient from @/lib/supabase/server).
 *   - Mobile callers send the request with `Authorization: Bearer <jwt>`
 *     (the access_token from supabase.auth.getSession()).
 *
 * Either path is verified against Supabase Auth before any deletion runs.
 */
export async function POST(req: NextRequest) {
  // 1. Identify the caller. Try cookie auth first (web), fall back to Bearer
  // token (mobile).
  let userId: string | null = null;
  let userEmail: string | null = null;

  try {
    const cookieClient = await createClient();
    const { data: { user } } = await cookieClient.auth.getUser();
    if (user) {
      userId = user.id;
      userEmail = user.email ?? null;
    }
  } catch {
    /* no cookie session */
  }

  if (!userId) {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token) {
      const admin = createServiceClient();
      const { data: { user }, error } = await admin.auth.getUser(token);
      if (!error && user) {
        userId = user.id;
        userEmail = user.email ?? null;
      }
    }
  }

  if (!userId) {
    return NextResponse.json(
      { error: "Not signed in. Send a valid auth cookie or Bearer token." },
      { status: 401 },
    );
  }

  // 2. Optional belt-and-braces — require the request to confirm the email
  // it thinks is being deleted. Helps catch programming bugs where the wrong
  // token is sent.
  let confirmEmail: string | null = null;
  try {
    const body = await req.json().catch(() => null);
    if (body && typeof body.confirmEmail === "string") {
      confirmEmail = body.confirmEmail.trim().toLowerCase();
    }
  } catch {
    /* no body, fine */
  }
  if (
    confirmEmail &&
    userEmail &&
    confirmEmail !== userEmail.toLowerCase()
  ) {
    return NextResponse.json(
      {
        error: `Confirmation email mismatch. Got "${confirmEmail}", account is "${userEmail}".`,
      },
      { status: 400 },
    );
  }

  // 3. Hard delete using the service role client (bypasses RLS).
  const admin = createServiceClient();

  try {
    // a. Find all venues owned by this user.
    const { data: venues, error: venueErr } = await admin
      .from("venues")
      .select("id")
      .eq("owner_id", userId);
    if (venueErr) throw venueErr;
    const venueIds = (venues ?? []).map((v) => v.id);

    if (venueIds.length > 0) {
      // b. Find all events at those venues, then clean child rows.
      const { data: events } = await admin
        .from("events")
        .select("id")
        .in("venue_id", venueIds);
      const eventIds = (events ?? []).map((e) => e.id);

      if (eventIds.length > 0) {
        await admin.from("event_artists").delete().in("event_id", eventIds);
        await admin.from("event_genres").delete().in("event_id", eventIds);
        await admin.from("events").delete().in("id", eventIds);
      }

      // c. Delete the venues themselves.
      await admin.from("venues").delete().in("id", venueIds);
    }

    // d. Best-effort cleanup of the user's other rows. We swallow individual
    // errors here because some of these tables may not exist for every user
    // (e.g. they were never an artist).
    // Detach the user from any artist page they claimed rather than deleting
    // the row — historical gigs link to it and the page becomes claimable
    // again for someone else (mirrors what /dashboard/account does).
    await admin.from("artists").update({ claimed_by: null }).eq("claimed_by", userId);
    await admin.from("venue_suggestions").delete().eq("submitted_by", userId);
    // Detach (don't delete) any pending/approved gigs the user submitted at
    // venues they don't own — those are useful historical content. Set
    // submitted_by to NULL so the auth.users row can be removed cleanly.
    await admin
      .from("events")
      .update({ submitted_by: null })
      .eq("submitted_by", userId);

    // e. Delete the profile row.
    await admin.from("profiles").delete().eq("id", userId);

    // f. Finally, delete the auth.users entry. After this, the user's
    // session token is invalid.
    const { error: deleteErr } = await admin.auth.admin.deleteUser(userId);
    if (deleteErr) {
      // Profile is already gone — log and surface, but the user's data is
      // effectively deleted at this point.
      console.error("[account/delete] auth.admin.deleteUser failed:", deleteErr);
      return NextResponse.json(
        {
          error:
            "Your data has been removed but the account itself failed to delete. Please email hello@thebuzzkids.co.uk and we'll finish it manually.",
          partial: true,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[account/delete] failed:", err);
    return NextResponse.json(
      { error: err?.message ?? "Account deletion failed." },
      { status: 500 },
    );
  }
}
