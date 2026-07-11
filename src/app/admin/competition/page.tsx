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
  let list: { name: string | null; email: string | null; entered: string; newSignup: boolean }[] = [];
  try {
    const { data: entryRows, error } = await sb
      .from("competition_entries").select("user_id, created_at")
      .eq("competition_slug", CIRCUS.slug).order("created_at", { ascending: false }).limit(5000);
    if (error) throw error;
    const ids = (entryRows ?? []).map((e) => e.user_id);
    const { data: profs } = ids.length
      ? await sb.from("profiles").select("id, display_name, email, created_at").in("id", ids)
      : { data: [] as any[] };
    const byId = new Map((profs ?? []).map((p: any) => [p.id, p]));
    list = (entryRows ?? []).map((e) => {
      const p: any = byId.get(e.user_id);
      const enteredMs = new Date(e.created_at).getTime();
      const acctMs = p?.created_at ? new Date(p.created_at).getTime() : 0;
      // "Signed up via the comp" = account created within 30 min of entering
      // (they made an account then were auto-entered). Existing members show a
      // much older account date.
      const newSignup = !!p && enteredMs - acctMs < 30 * 60 * 1000;
      return { name: p?.display_name ?? null, email: p?.email ?? null, entered: e.created_at, newSignup };
    });
  } catch {
    tablesMissing = true;
  }
  const entries = list.length;
  const newSignups = list.filter((l) => l.newSignup).length;

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
              <p className="text-xs text-buzz-mute">🆕 New signups via the comp</p>
              <p className="text-3xl font-bold mt-1">{newSignups}</p>
            </div>
          </div>

          <div className="card p-4 mb-6">
            <p className="text-sm font-medium mb-1">Draw the winner</p>
            <p className="text-xs text-buzz-mute mb-3">
              Picks a random entrant and shows their name + email so you can get in touch. {closed ? "The competition has closed." : "You can draw any time (ideally after it closes)."}
            </p>
            <DrawCircus />
          </div>

          <h2 className="font-display text-2xl mb-1">Entrants ({entries})</h2>
          <p className="text-xs text-buzz-mute mb-3">
            <span className="font-bold text-buzz-accent">NEW</span> = created their account to enter (a fresh member). Others already had an account.
          </p>
          {list.length === 0 ? (
            <p className="text-sm text-buzz-mute">No entries yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {list.map((l, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-buzz-border bg-buzz-card px-3 py-2 text-sm">
                  {l.newSignup && (
                    <span className="shrink-0 text-[10px] font-bold bg-buzz-accent text-white rounded-full px-1.5 py-0.5">NEW</span>
                  )}
                  <span className="font-medium truncate">{l.name || "(no name)"}</span>
                  <span className="text-buzz-mute truncate min-w-0">{l.email}</span>
                  <span className="text-buzz-mute ml-auto shrink-0 text-xs">
                    {new Date(l.entered).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
