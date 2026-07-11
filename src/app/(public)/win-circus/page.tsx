import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { CIRCUS, circusClosed } from "@/lib/competition";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Win a family ticket to Circus Extreme — The Buzz Kids",
  description: "Create a free Buzz Kids account for your chance to win a family ticket to Circus Extreme.",
};

export default async function WinCircusPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Master switch: while the competition isn't open, show a dormant page and
  // enter nobody — safe to have the URL live before you announce.
  if (!CIRCUS.open) {
    return (
      <div className="container-page py-20 text-center max-w-lg">
        <div className="text-5xl mb-4">🎪</div>
        <h1 className="h-display text-3xl mb-2">Competition coming soon</h1>
        <p className="text-buzz-mute mb-8">Check back shortly — we&apos;ve got a cracking family prize on the way.</p>
        <Link href="/browse" className="btn-primary">Browse things to do</Link>
      </div>
    );
  }

  const closed = circusClosed();

  // Logged in? You're in. We enter you the moment you land here (one entry per
  // account), so there's no separate button and no redirect to lose people —
  // works for brand-new signups and existing members alike.
  let entered = false;
  if (user && !closed) {
    try {
      const sb = createServiceClient();
      await sb.from("competition_entries").upsert(
        { competition_slug: CIRCUS.slug, user_id: user.id },
        { onConflict: "competition_slug,user_id", ignoreDuplicates: true },
      );
      entered = true;
    } catch { /* table may not exist yet */ }
  } else if (user && closed) {
    try {
      const sb = createServiceClient();
      const { data } = await sb
        .from("competition_entries").select("id")
        .eq("competition_slug", CIRCUS.slug).eq("user_id", user.id).maybeSingle();
      entered = !!data;
    } catch { /* ignore */ }
  }

  return (
    <div className="container-page py-12 max-w-2xl">
      <div className="text-center mb-8">
        <p className="eyebrow mb-2" style={{ color: "#EC1E8C" }}>Competition</p>
        <h1 className="font-display text-4xl sm:text-6xl leading-none mb-4">Win a family ticket to</h1>
        <a href={CIRCUS.website} target="_blank" rel="noopener" className="block max-w-md mx-auto mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CIRCUS.logo} alt="Circus Extreme" className="w-full h-auto" />
        </a>
        <p className="text-buzz-mute text-lg max-w-xl mx-auto">{CIRCUS.prizeLine}</p>
      </div>

      {/* Where it's on — compact, centred cards (not full-width) */}
      <div className="flex flex-wrap justify-center gap-3 mb-8">
        {CIRCUS.locations.map((l) => (
          <div key={l.city} className="rounded-2xl border border-buzz-border bg-buzz-card px-4 py-3 w-full sm:w-auto sm:min-w-[15rem]">
            <p className="font-display text-xl leading-none mb-1">{l.city}</p>
            <p className="text-sm text-buzz-text">{l.place}</p>
            <p className="text-sm text-buzz-mute mt-1">📅 {l.dates}</p>
          </div>
        ))}
      </div>

      {/* Action box */}
      <div className="rounded-2xl border-2 p-6 text-center" style={{ borderColor: "#EC1E8C" }}>
        {closed ? (
          <>
            <p className="font-display text-2xl mb-2">This competition has closed 🎪</p>
            <p className="text-buzz-mute mb-5">
              {entered ? "You were entered — thanks for playing! The winner has been drawn." : "Thanks to everyone who entered — the winner has been drawn."}
            </p>
            <Link href="/browse" className="btn-secondary">Browse things to do</Link>
          </>
        ) : entered ? (
          <>
            <p className="font-display text-3xl mb-2" style={{ color: "#6FA713" }}>✅ You&apos;re entered!</p>
            <p className="text-buzz-mute mb-4">
              Good luck! The winner is drawn on <strong>{CIRCUS.winnerText}</strong>. We&apos;ll email you if it&apos;s you.
            </p>
            <div className="flex gap-2 justify-center flex-wrap">
              <Link href="/browse" className="btn-secondary">Browse things to do</Link>
              <Link href="/dashboard/favourites" className="btn-secondary">Your bucket list</Link>
            </div>
          </>
        ) : (
          <>
            <p className="font-display text-2xl mb-1">Create a free account to enter</p>
            <p className="text-buzz-mute mb-5">
              Takes 30 seconds — you&apos;re entered the moment your account&apos;s made, and you can save days out to your bucket list.
            </p>
            <Link
              href="/signup?next=/win-circus"
              className="inline-block w-full sm:w-auto px-8 h-14 leading-[3.5rem] rounded-2xl text-white text-lg font-semibold"
              style={{ background: "#EC1E8C" }}
            >
              Create free account to enter →
            </Link>
            <p className="text-sm text-buzz-mute mt-4">
              Already a member?{" "}
              <Link href="/login?next=/win-circus" className="text-buzz-accent font-medium">Sign in to enter</Link>
            </p>
          </>
        )}
      </div>

      <p className="text-center mt-6 text-sm">
        <a href={CIRCUS.website} target="_blank" rel="noopener" className="text-buzz-accent font-medium">
          Full show info &amp; dates at circusextreme.co.uk →
        </a>
      </p>
      <p className="text-xs text-buzz-mute text-center mt-4 max-w-lg mx-auto leading-relaxed">
        Entries close at {CIRCUS.closesText}. One entry per account. Winner drawn at random and notified by email.
        Winner must be able to attend a listed location on a listed date. Prize is a family ticket for up to 4
        people, valid at any location. The Buzz Kids competition is not affiliated with or run by Circus Extreme.
      </p>
    </div>
  );
}
