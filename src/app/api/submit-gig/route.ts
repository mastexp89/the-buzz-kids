import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { submitGig } from "@/app/submit-gig/actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/submit-gig
 *
 * Mobile-friendly wrapper around the web's submitGig server action.
 * Accepts JSON; web continues to use the server action directly via the
 * /submit-gig form (which submits FormData).
 *
 * Auth model — same as /api/account/delete:
 *   Web: cookie session (handled inside submitGig itself).
 *   Mobile: Authorization: Bearer <jwt> from supabase.auth.getSession().
 *
 * For mobile we have to "stamp" a session into the server-side cookie store
 * so submitGig's own supabase.auth.getUser() call sees the user. The cleanest
 * way to do that without rewriting submitGig is to re-export the bearer-only
 * version of the action that takes a verified userId/email and uses the
 * service role client. To keep this PR small, we do the simpler thing: verify
 * the JWT, then drop into the existing server-action code path by putting
 * the bearer token into a fake cookie header on a forked request — but that
 * introduces magic. Instead we re-implement the submitGig flow inline using
 * the service role + verified user — so mobile gets identical behaviour
 * without us having to refactor submitGig itself.
 *
 * Body shape (all optional unless noted):
 *   {
 *     venueId?: string,             // pick existing venue
 *     newVenue?: {                  // OR suggest a new one
 *       name: string,               // required
 *       cityId: string,             // required
 *       address?: string,
 *       postcode?: string,
 *       website?: string,
 *     },
 *     title: string,                // REQUIRED
 *     description?: string,
 *     startTime: string,            // REQUIRED — ISO 8601
 *     endTime?: string,
 *     coverCharge?: string,
 *     ticketUrl?: string,
 *     imageUrl?: string,
 *     genreIds?: string[],
 *     existingArtistIds?: string[],
 *     newArtistNames?: string[],
 *     selfArtistName?: string,
 *     submitterName?: string,
 *     submitterContact?: string,
 *   }
 */
export async function POST(req: NextRequest) {
  // 1. Identify caller (cookie or Bearer)
  let userId: string | null = null;
  let userEmail: string | null = null;
  try {
    const cookieClient = await createClient();
    const { data: { user } } = await cookieClient.auth.getUser();
    if (user) { userId = user.id; userEmail = user.email ?? null; }
  } catch { /* no cookie session */ }

  if (!userId) {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token) {
      const admin = createServiceClient();
      const { data: { user }, error } = await admin.auth.getUser(token);
      if (!error && user) { userId = user.id; userEmail = user.email ?? null; }
    }
  }
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // 2. If we got here via cookie auth, just delegate to the server action and convert JSON → FormData.
  // If we got here via Bearer auth, do the same — but cookie session isn't set, so submitGig's
  // internal getUser() will fail. We handle that by short-circuiting with our own minimal flow.
  // For simplicity and correctness, we always go through the bearer path when token is present.
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Bad request body." }, { status: 400 });

  // Cookie path: build FormData, hand off to existing server action.
  // (Server action will call its own getUser() against the same cookie.)
  const cookieAuth = req.headers.get("cookie")?.includes("sb-") || false;
  if (cookieAuth) {
    const fd = jsonToFormData(body);
    const result = await submitGig(fd);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result);
  }

  // Bearer path: re-implement the minimum needed using the service role client.
  // We deliberately mirror the same status/auto-approve logic submitGig uses
  // so the public outcome is identical regardless of which entry point you used.
  const admin = createServiceClient();
  return await runBearerSubmit(admin, userId, userEmail, body);
}

// Convert the JSON body to a FormData suitable for the server-action signature.
function jsonToFormData(body: any): FormData {
  const fd = new FormData();
  const set = (k: string, v: any) => { if (v != null) fd.set(k, String(v)); };
  const append = (k: string, v: any) => { if (v != null) fd.append(k, String(v)); };

  set("venue_id", body.venueId);
  set("new_venue_name", body.newVenue?.name);
  set("new_venue_city_id", body.newVenue?.cityId);
  set("new_venue_address", body.newVenue?.address);
  set("new_venue_postcode", body.newVenue?.postcode);
  set("new_venue_website", body.newVenue?.website);

  set("title", body.title);
  set("description", body.description);
  set("start_time", body.startTime);
  set("end_time", body.endTime);
  set("cover_charge", body.coverCharge);
  set("ticket_url", body.ticketUrl);
  set("image_url", body.imageUrl);
  set("self_artist_name", body.selfArtistName);
  set("submitter_name", body.submitterName);
  set("submitter_contact", body.submitterContact);

  for (const g of body.genreIds ?? []) append("genres", g);
  for (const a of body.existingArtistIds ?? []) append("artist_ids", a);
  for (const n of body.newArtistNames ?? []) append("new_artist_names", n);

  return fd;
}

// Minimal mobile-bearer-path submitter. Mirrors the structure of submitGig but
// uses the service role client so it doesn't need a cookie session.
async function runBearerSubmit(
  admin: ReturnType<typeof createServiceClient>,
  userId: string,
  userEmail: string | null,
  body: any,
) {
  const title = String(body.title ?? "").trim();
  const startTime = body.startTime ? new Date(body.startTime).toISOString() : null;
  if (!title || !startTime) {
    return NextResponse.json({ error: "Title and start time are required." }, { status: 400 });
  }

  // Path A — existing venue
  if (body.venueId) {
    const { data: venue } = await admin
      .from("venues")
      .select("id, name, slug, owner_id, city:cities(slug)")
      .eq("id", body.venueId)
      .single();
    if (!venue) return NextResponse.json({ error: "That venue could not be found." }, { status: 404 });

    const autoApprove = !venue.owner_id;
    const status = autoApprove ? "approved" : "pending";

    const { data: created, error } = await admin
      .from("events")
      .insert({
        venue_id: venue.id,
        title,
        description: body.description ?? null,
        start_time: startTime,
        end_time: body.endTime ? new Date(body.endTime).toISOString() : null,
        cover_charge: body.coverCharge ?? null,
        ticket_url: body.ticketUrl ?? null,
        image_url: body.imageUrl ?? null,
        status,
        submitted_by: userId,
      })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (Array.isArray(body.genreIds) && body.genreIds.length) {
      await admin.from("event_genres").insert(
        body.genreIds.map((gid: string) => ({ event_id: created.id, genre_id: gid })),
      );
    }
    if (Array.isArray(body.existingArtistIds) && body.existingArtistIds.length) {
      await admin.from("event_artists").insert(
        body.existingArtistIds.map((aid: string) => ({ event_id: created.id, artist_id: aid })),
      );
    }

    return NextResponse.json({
      ok: true,
      kind: autoApprove ? "approved_listed" : "pending_listed",
      venueName: venue.name,
      venueSlug: venue.slug,
      citySlug: (venue as any).city?.slug ?? "dundee",
    });
  }

  // Path B — unlisted venue suggestion
  if (!body.newVenue?.name) {
    return NextResponse.json(
      { error: "Pick a venue or enter the venue name." },
      { status: 400 },
    );
  }

  const { error: sugErr } = await admin
    .from("venue_suggestions")
    .insert({
      submitted_by: userId,
      venue_name: body.newVenue.name,
      city_id: body.newVenue.cityId,
      address: body.newVenue.address ?? null,
      postcode: body.newVenue.postcode ?? null,
      website: body.newVenue.website ?? null,
      gig_title: title,
      gig_start_time: startTime,
      gig_end_time: body.endTime ? new Date(body.endTime).toISOString() : null,
      gig_cover_charge: body.coverCharge ?? null,
      gig_ticket_url: body.ticketUrl ?? null,
      gig_image_url: body.imageUrl ?? null,
      gig_description: body.description ?? null,
      submitter_name: body.submitterName ?? null,
      submitter_contact: body.submitterContact ?? null,
      extras: {
        genre_ids: body.genreIds ?? [],
        existing_artist_ids: body.existingArtistIds ?? [],
        new_artist_names: body.newArtistNames ?? [],
        self_artist_name: body.selfArtistName ?? null,
        source: "mobile",
      },
      status: "pending",
    });
  if (sugErr) return NextResponse.json({ error: sugErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    kind: "pending_unlisted",
    venueName: body.newVenue.name,
  });
}
