"use client";

import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

let _stripePromise: Promise<Stripe | null> | null = null;
function getStripe() {
  if (!_stripePromise) {
    _stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);
  }
  return _stripePromise;
}

type Props = {
  open: boolean;
  onClose: () => void;
  // Pulls a fresh Checkout Session each time the modal opens so we get a new client_secret
  fetchClientSecret: () => Promise<string>;
  title?: string;
};

export default function CheckoutModal({ open, onClose, fetchClientSecret, title = "Checkout" }: Props) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setClientSecret(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setError(null);
    fetchClientSecret()
      .then((cs) => {
        if (!cancelled) setClientSecret(cs);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? "Could not start checkout");
      });
    return () => {
      cancelled = true;
    };
  }, [open, fetchClientSecret]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-buzz-card w-full sm:max-w-2xl sm:max-h-[90vh] sm:rounded-2xl overflow-hidden border border-buzz-border flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-buzz-border/60 shrink-0">
          <h2 className="font-display text-xl uppercase">{title}</h2>
          <button onClick={onClose} className="text-buzz-mute hover:text-buzz-text text-2xl leading-none px-2">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-white">
          {error ? (
            <div className="p-8 text-center">
              <p className="text-rose-500 font-semibold mb-2">Couldn't start checkout</p>
              <p className="text-zinc-600 text-sm">{error}</p>
              <button onClick={onClose} className="btn-secondary mt-6">Close</button>
            </div>
          ) : !clientSecret ? (
            <div className="p-12 text-center text-zinc-500">Loading payment form…</div>
          ) : (
            <EmbeddedCheckoutProvider
              stripe={getStripe()}
              options={{
                clientSecret,
                onComplete: () => {
                  // Stripe also redirects to return_url; this fires when the form
                  // finishes if you set ui_mode=embedded. We close + refresh.
                  onClose();
                  router.refresh();
                },
              }}
            >
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          )}
        </div>
      </div>
    </div>
  );
}
