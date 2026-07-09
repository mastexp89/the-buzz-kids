import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";
import { expandSlices, type WheelPrize } from "@/lib/wheel";
import LuckyWheel from "@/components/LuckyWheel";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Lucky spin — The Buzz Kids",
  description: "Spin the wheel for a chance to win a family day out.",
  robots: { index: false }, // don't index the competition page
};

export default async function WinPage({ searchParams }: { searchParams: Promise<{ confirmed?: string }> }) {
  const sp = await searchParams;
  const sb = createServiceClient();

  let active = false;
  let grandPrize = "a family day out";
  let grandDetail: string | null = null;
  let closesOn: string | null = null;
  let slices: ReturnType<typeof expandSlices> = [];

  try {
    const { data: cfg } = await sb.from("wheel_config").select("grand_prize, grand_detail, closes_on, active").eq("id", 1).maybeSingle();
    if (cfg) {
      active = !!cfg.active;
      grandPrize = cfg.grand_prize ?? grandPrize;
      grandDetail = cfg.grand_detail ?? null;
      closesOn = cfg.closes_on ?? null;
    }
    const { data: prizes } = await sb.from("wheel_prizes").select("id, label, kind, slots, color, sort, active").eq("active", true);
    slices = expandSlices((prizes ?? []) as WheelPrize[]);
  } catch {
    active = false; // tables not created yet → treat as no competition
  }

  const closed = active && closesOn && closesOn < new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

  if (!active || closed || slices.length === 0) {
    return (
      <div className="container-page py-20 text-center max-w-lg">
        <div className="text-5xl mb-4">🎪</div>
        <h1 className="h-display text-3xl mb-2">No competition running right now</h1>
        <p className="text-buzz-mute mb-8">
          {closed ? "This one's just closed — thanks to everyone who played!" : "Check back soon — we run family giveaways regularly."}
        </p>
        <Link href="/browse" className="btn-primary">Browse things to do</Link>
      </div>
    );
  }

  return (
    <div className="container-page py-12">
      {sp.confirmed === "1" && (
        <div className="max-w-5xl mx-auto mb-8 rounded-xl px-4 py-3 text-center text-sm font-medium" style={{ background: "#E9F7E0", color: "#3B6D11" }}>
          ✅ Email confirmed — you&apos;re in the draw! Come back each day to spin for more entries.
        </div>
      )}
      <LuckyWheel grandPrize={grandPrize} grandDetail={grandDetail} closesOn={closesOn} slices={slices} />
    </div>
  );
}
