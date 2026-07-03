import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyUnsub } from "@/lib/unsubscribe";

export const dynamic = "force-dynamic";
export const metadata = { title: "Unsubscribe — The Buzz Kids", robots: { index: false } };

type Props = { searchParams: Promise<{ e?: string; t?: string }> };

export default async function UnsubscribePage({ searchParams }: Props) {
  const { e, t } = await searchParams;
  const email = (e ?? "").trim().toLowerCase();
  const ok = !!email && verifyUnsub(email, t ?? "");

  let done = false;
  if (ok) {
    const sb = createServiceClient();
    // Idempotent — safe if they click twice.
    await sb.from("email_unsubscribes").upsert({ email }, { onConflict: "email", ignoreDuplicates: true });
    done = true;
  }

  return (
    <div className="container-page py-20 max-w-lg text-center">
      {done ? (
        <>
          <div className="text-5xl mb-4">👋</div>
          <h1 className="h-display text-4xl mb-3">You're unsubscribed</h1>
          <p className="text-buzz-mute mb-2">
            We won't send <strong className="text-buzz-text">{email}</strong> any more newsletters or announcements.
          </p>
          <p className="text-buzz-mute text-sm mb-8">
            You'll still get essential emails about anything you've actively signed up for. Changed your mind? Just re-subscribe next time you're on the site.
          </p>
          <Link href="/browse" className="btn-secondary">Browse The Buzz Kids →</Link>
        </>
      ) : (
        <>
          <div className="text-5xl mb-4">🐝</div>
          <h1 className="h-display text-4xl mb-3">Link not valid</h1>
          <p className="text-buzz-mute mb-8">
            This unsubscribe link looks broken or incomplete. Please use the link from the bottom of a recent email, or
            email <a href="mailto:hello@thebuzzkids.co.uk" className="text-buzz-accent hover:underline">hello@thebuzzkids.co.uk</a> and we'll sort it.
          </p>
          <Link href="/" className="btn-secondary">Back to home →</Link>
        </>
      )}
    </div>
  );
}
