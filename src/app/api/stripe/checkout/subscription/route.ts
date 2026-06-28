import { NextRequest, NextResponse } from "next/server";
import { stripe, PRICING } from "@/lib/stripe";
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

    const body = await req.json();
    const { venueId, embedded } = body as { venueId: string; embedded?: boolean };
    if (!venueId) return NextResponse.json({ error: "venueId required" }, { status: 400 });

    // Confirm the venue belongs to this user
    const { data: venue } = await supabase
      .from("venues").select("id, name, owner_id").eq("id", venueId).maybeSingle();
    if (!venue || venue.owner_id !== user.id) {
      return NextResponse.json({ error: "Not your venue" }, { status: 403 });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thebuzzguide.co.uk";

    // Reuse / create Stripe customer for this user
    const { data: profile } = await supabase
      .from("profiles").select("stripe_customer_id, display_name").eq("id", user.id).maybeSingle();

    let customerId = profile?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: profile?.display_name ?? undefined,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      await supabase.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id);
    }

    // Build the session config — same for both embedded and hosted modes
    const baseConfig = {
      mode: "subscription" as const,
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: PRICING.subscription.currency,
            unit_amount: PRICING.subscription.amount_cents,
            recurring: { interval: PRICING.subscription.interval },
            product_data: {
              name: `${PRICING.subscription.name} — ${venue.name}`,
              description: PRICING.subscription.description,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        kind: "subscription",
        venue_id: venue.id,
        owner_id: user.id,
      },
      subscription_data: {
        metadata: {
          venue_id: venue.id,
          owner_id: user.id,
        },
      },
      allow_promotion_codes: true,
    };

    if (embedded) {
      const session = await stripe.checkout.sessions.create({
        ...baseConfig,
        ui_mode: "embedded" as any,
        return_url: `${siteUrl}/dashboard/venues/${venue.id}?subscribed=1&session_id={CHECKOUT_SESSION_ID}`,
      } as any);
      return NextResponse.json({ clientSecret: session.client_secret });
    }

    const session = await stripe.checkout.sessions.create({
      ...baseConfig,
      success_url: `${siteUrl}/dashboard/venues/${venue.id}?subscribed=1`,
      cancel_url: `${siteUrl}/dashboard/venues/${venue.id}?subscribe_cancelled=1`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error("[stripe/checkout/subscription] error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown error", code: err?.code, type: err?.type },
      { status: 500 },
    );
  }
}
