import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe, PRICING, type PromotionKind } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Stripe sends the webhook as a raw body — Next 15+ App Router supports this via .text()
export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err: any) {
    return NextResponse.json({ error: `Webhook verification failed: ${err.message}` }, { status: 400 });
  }

  const supabase = createServiceClient();

  try {
    switch (event.type) {
      // ─── Subscription / Checkout events ────────────────────────────────
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const meta = session.metadata ?? {};
        const venueId = meta.venue_id as string | undefined;
        const ownerId = meta.owner_id as string | undefined;
        const kind = meta.kind as string | undefined;

        if (kind === "subscription" && venueId && session.subscription) {
          await supabase
            .from("venues")
            .update({
              subscription_id: String(session.subscription),
              subscription_status: "active",
            })
            .eq("id", venueId);

          // Also record the first subscription payment immediately, in case
          // invoice.paid arrives late or out of order. Idempotent on session ID.
          if (session.amount_total && session.amount_total > 0) {
            const { data: existing } = await supabase
              .from("payments").select("id").eq("stripe_checkout_session_id", session.id).maybeSingle();
            if (!existing) {
              await supabase.from("payments").insert({
                venue_id: venueId,
                owner_id: ownerId,
                type: "subscription",
                amount_cents: session.amount_total,
                currency: session.currency ?? "gbp",
                stripe_checkout_session_id: session.id,
                description: PRICING.subscription.name,
              });
            }
          }
        }

        if (kind === "promotion" && venueId && meta.promotion_kind) {
          const pk = meta.promotion_kind as PromotionKind;
          const cfg = PRICING.promotions[pk];
          const eventId = (meta.event_id as string | undefined) || null;

          // Idempotency — bail out early if we've already processed this session.
          // Stripe retries webhooks (e.g. after secret rotation, network blips,
          // or any non-200 response) and the same checkout.session.completed
          // event can be delivered multiple times.
          const { data: existing } = await supabase
            .from("payments")
            .select("id")
            .eq("stripe_checkout_session_id", session.id)
            .maybeSingle();
          if (existing) {
            console.log(
              "[stripe webhook] Skipping duplicate promotion delivery for session",
              session.id,
            );
            break;
          }

          // Activate the promotion by setting the right *_until column
          const until = new Date(Date.now() + cfg.duration_days * 24 * 60 * 60 * 1000).toISOString();
          const targetTable: "venues" | "events" = pk === "spotlight" ? "venues" : "events";
          const targetId = pk === "spotlight" ? venueId : eventId;
          const column =
            pk === "spotlight" ? "spotlight_until"
            : pk === "featured_pin" ? "featured_until"
            : pk === "highlighted_gig" ? "highlighted_until"
            : pk === "genre_takeover" ? "genre_takeover_until"
            : "weekend_boost_until";
          if (targetId) {
            await supabase.from(targetTable).update({ [column]: until }).eq("id", targetId);
          }

          // Record the payment
          await supabase.from("payments").insert({
            venue_id: venueId,
            owner_id: ownerId,
            type: "promotion",
            promotion_kind: pk,
            event_id: eventId,
            amount_cents: cfg.amount_cents,
            currency: "gbp",
            stripe_checkout_session_id: session.id,
            stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
            description: cfg.name,
          });
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as any;

        // Try every place Stripe might put the subscription ID
        // (the new "basil" API changed where this lives)
        const subId =
          (typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id) ??
          invoice.parent?.subscription_details?.subscription ??
          invoice.lines?.data?.[0]?.subscription ??
          invoice.lines?.data?.[0]?.subscription_item ??
          null;

        // Find the venue — try subscription_id first, fall back to customer lookup
        let venue: { id: string; owner_id: string } | null = null;
        if (subId) {
          const { data } = await supabase
            .from("venues").select("id, owner_id")
            .eq("subscription_id", subId).maybeSingle();
          venue = data as any;
        }
        if (!venue && invoice.customer) {
          const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer.id;
          const { data: profile } = await supabase
            .from("profiles").select("id").eq("stripe_customer_id", customerId).maybeSingle();
          if (profile) {
            const { data: v } = await supabase
              .from("venues").select("id, owner_id")
              .eq("owner_id", profile.id)
              .eq("subscription_status", "active")
              .limit(1).maybeSingle();
            venue = v as any;
          }
        }
        if (!venue) {
          console.warn("[invoice.paid] Could not match invoice to a venue", { subId, customer: invoice.customer });
          break;
        }

        // Idempotency — don't double-insert if we've already recorded this invoice
        const { data: existing } = await supabase
          .from("payments").select("id").eq("stripe_invoice_id", invoice.id).maybeSingle();
        if (!existing) {
          await supabase.from("payments").insert({
            venue_id: venue.id,
            owner_id: venue.owner_id,
            type: "subscription",
            amount_cents: invoice.amount_paid ?? 0,
            currency: invoice.currency ?? "gbp",
            stripe_invoice_id: invoice.id,
            stripe_payment_intent_id: typeof invoice.payment_intent === "string" ? invoice.payment_intent : null,
            description: PRICING.subscription.name,
          });
        }

        // Refresh period end on the venue
        const periodEnd = invoice.lines?.data?.[0]?.period?.end;
        if (periodEnd) {
          await supabase
            .from("venues")
            .update({
              subscription_status: "active",
              current_period_end: new Date(periodEnd * 1000).toISOString(),
            })
            .eq("id", venue.id);
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as any;
        const status = sub.status; // active, past_due, canceled, unpaid, etc.
        await supabase
          .from("venues")
          .update({
            subscription_status: status,
            current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
          })
          .eq("subscription_id", sub.id);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as any;
        const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
        if (subId) {
          await supabase
            .from("venues")
            .update({ subscription_status: "past_due" })
            .eq("subscription_id", subId);
        }
        break;
      }

      default:
        // No-op for events we don't track yet.
        break;
    }
  } catch (err: any) {
    console.error("[Stripe webhook] handler error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
