import { NextRequest, NextResponse } from "next/server";
import { stripe, PRICING, type PromotionKind } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
 try {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "STRIPE_SECRET_KEY is not set on the server." }, { status: 500 });
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { venueId, kind, eventId, embedded } = await req.json() as {
    venueId: string;
    kind: PromotionKind;
    eventId?: string;
    embedded?: boolean;
  };

  if (!venueId || !kind || !(kind in PRICING.promotions)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Spotlight applies to the venue itself; everything else needs an event.
  if (kind !== "spotlight" && !eventId) {
    return NextResponse.json({ error: "eventId required for this promotion" }, { status: 400 });
  }

  // Confirm venue ownership
  const { data: venue } = await supabase
    .from("venues").select("id, name, owner_id").eq("id", venueId).maybeSingle();
  if (!venue || venue.owner_id !== user.id) {
    return NextResponse.json({ error: "Not your venue" }, { status: 403 });
  }

  const cfg = PRICING.promotions[kind];
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thebuzzguide.co.uk";

  // Customer
  const { data: profile } = await supabase
    .from("profiles").select("stripe_customer_id").eq("id", user.id).maybeSingle();

  let customerId = profile?.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { user_id: user.id },
    });
    customerId = customer.id;
    await supabase.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id);
  }

  const baseConfig = {
    mode: "payment" as const,
    customer: customerId,
    line_items: [
      {
        price_data: {
          currency: "gbp",
          unit_amount: cfg.amount_cents,
          product_data: {
            name: `${cfg.name} — ${venue.name}`,
            description: cfg.description,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      kind: "promotion",
      promotion_kind: kind,
      venue_id: venue.id,
      owner_id: user.id,
      event_id: eventId ?? "",
    },
  };

  if (embedded) {
    const session = await stripe.checkout.sessions.create({
      ...baseConfig,
      ui_mode: "embedded" as any,
      return_url: `${siteUrl}/dashboard/venues/${venue.id}/promote?activated=${kind}&session_id={CHECKOUT_SESSION_ID}`,
    } as any);
    return NextResponse.json({ clientSecret: session.client_secret });
  }

  const session = await stripe.checkout.sessions.create({
    ...baseConfig,
    success_url: `${siteUrl}/dashboard/venues/${venue.id}/promote?activated=${kind}`,
    cancel_url: `${siteUrl}/dashboard/venues/${venue.id}/promote?cancelled=1`,
  });
  return NextResponse.json({ url: session.url });
 } catch (err: any) {
  console.error("[stripe/checkout/promotion] error:", err);
  return NextResponse.json(
    { error: err?.message ?? "Unknown error", code: err?.code, type: err?.type },
    { status: 500 },
  );
 }
}
