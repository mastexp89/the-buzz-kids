import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { CIRCUS, circusClosed } from "@/lib/competition";
import DrawCircus from "./DrawCircus";

export const dynamic = "force-dynamic";
export const metadata = { title: "Circus competition — The Buzz Kids admin" };

export default async function CompetitionPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/competition");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/admin" className="btn-secondary mt-6 inline-block">Back to admin</Link>
      </div>
    );
  }

  const closed = circusClosed();
  const sb = createServiceClient();
  let tablesMissing = false;
  let entries = 0;
  let recent = 0;
  try {
    const { count } = await sb.from("competition_entries").select("id", { count: "exact", head: true }).eq("competition_slug", CIRCUS.slug);
    if (count === null) throw new Error("no count");
    entries = count ?? 0;
    // entries in the last 7 days (a proxy for "since the FB post")
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const { count: r } = await sb.from("competition_entries").select("id", { count: "exact", head: true }).eq("competition_slug", CIRCUS.slug).gte("created_at", since);
    recent = r ?? 0;
  } catch {
    tablesMissing = true;
  }

  return (
    <div className="container-page py-10 max-w-2xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">← Back to admin</Link>
      <p className="eyebrow mt-4 mb-1">Marketing</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">Circus Extreme comp 🎪</h1>
      <p className="text-buzz-mute mb-6 max-w-xl">
        Entries come from people creating (or signing into) a free account at{" "}
        <Link href="/win-circus" className="text-buzz-accent">/win-circus</Link> — that&apos;s the link to share on Facebook.
        Closes <strong>{CIRCUS.closesText}</strong> · winner drawn <strong>{CIRCUS.winnerText}</strong>.
      </p>

      {tablesMissing ? (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "#FDECEC", color: "#a3282a" }}>
          ⚠ Run <code>sql/092_competition_entries.sql</code> in Supabase, then refresh.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="rounded-xl bg-buzz-card border border-buzz-border p-4">
              <p className="text-xs text-buzz-mute">Total entries</p>
              <p className="text-3xl font-bold mt-1">{entries}</p>
            </div>
            <div className="rounded-xl bg-buzz-card border border-buzz-border p-4">
              <p className="text-xs text-buzz-mute">Entered in last 7 days</p>
              <p className="text-3xl font-bold mt-1">{recent}</p>
            </div>
          </div>

          <div className="card p-4">
            <p className="text-sm font-medium mb-1">Draw the winner</p>
            <p className="text-xs text-buzz-mute mb-3">
              Picks a random entrant and shows their name + email so you can get in touch. {closed ? "The competition has closed." : "You can draw any time (ideally after it closes)."}
            </p>
            <DrawCircus />
          </div>
        </>
      )}
    </div>
  );
}
