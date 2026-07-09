"use client";

import { useState, useRef } from "react";
import { spinWheel } from "@/lib/wheel-actions";
import { conicGradient, type WheelSlice } from "@/lib/wheel";

type Props = {
  grandPrize: string;
  grandDetail: string | null;
  closesOn: string | null;
  slices: WheelSlice[];
};

export default function LuckyWheel({ grandPrize, grandDetail, closesOn, slices }: Props) {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"win" | "info" | "error">("info");
  const rotationRef = useRef(0);
  const [rotation, setRotation] = useState(0);

  const step = 360 / slices.length;
  const closesLabel = closesOn
    ? new Date(closesOn + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    : null;

  async function handleSpin() {
    if (spinning || done) return;
    setMessage("");
    setSpinning(true);

    const res = await spinWheel(email, consent);

    if (!res.ok) {
      setSpinning(false);
      setMessageTone(res.reason === "already_email" || res.reason === "already_ip" ? "info" : "error");
      setMessage(res.message + (res.entries ? ` You've got ${res.entries} ${res.entries === 1 ? "entry" : "entries"} so far.` : ""));
      return;
    }

    // Land the chosen slice under the top pointer: 5 full turns + offset.
    const target = rotationRef.current + 360 * 5 + (360 - (res.sliceIndex * step + step / 2));
    rotationRef.current = target;
    setRotation(target);

    window.setTimeout(() => {
      setSpinning(false);
      setDone(true);
      setMessageTone("win");
      if (res.kind === "entry") {
        setMessage(
          res.needsConfirm
            ? `🎪 ${res.label}! Check your inbox and confirm your email to lock it in.`
            : `🎪 ${res.label}! You're in — you've now got ${res.entries} ${res.entries === 1 ? "entry" : "entries"}. Come back tomorrow for another spin!`,
        );
      } else {
        setMessage(
          res.needsConfirm
            ? `🎉 You won ${res.label}! Check your inbox and confirm your email to claim it.`
            : `🎉 You won ${res.label}! We'll be in touch to sort it. Come back tomorrow for another spin!`,
        );
      }
    }, 4600);
  }

  const canSpin = email.trim().length > 0 && consent && !spinning && !done;

  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:items-center max-w-5xl mx-auto">
      {/* Left: pitch + form */}
      <div>
        <p className="eyebrow mb-2" style={{ color: "#EC1E8C" }}>This month&apos;s big prize</p>
        <h1 className="font-display text-4xl sm:text-5xl leading-none mb-3" style={{ color: "#9B4DFF" }}>
          Win {grandPrize}
        </h1>
        {closesLabel && (
          <span className="inline-block rounded-full text-xs font-semibold px-3 py-1 mb-4" style={{ background: "#FFF0D6", color: "#8a5a00" }}>
            Draw closes {closesLabel}
          </span>
        )}
        {grandDetail && <p className="text-buzz-mute leading-relaxed mb-5 max-w-md">{grandDetail}</p>}

        <div className="max-w-md">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="name@email.com"
            value={email}
            disabled={done}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-12 rounded-xl border border-buzz-border bg-buzz-card px-4 text-base outline-none focus:border-buzz-accent transition mb-3"
          />
          <label className="flex gap-2 text-xs text-buzz-mute leading-snug mb-4 cursor-pointer">
            <input type="checkbox" checked={consent} disabled={done} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 shrink-0" />
            <span>
              I&apos;m happy to get occasional Buzz Kids emails (unsubscribe anytime). I&apos;ve read the{" "}
              <a href="/privacy" target="_blank" className="text-buzz-accent underline">privacy policy</a>.
            </span>
          </label>
          <button
            onClick={handleSpin}
            disabled={!canSpin}
            className="w-full h-12 rounded-2xl text-white text-lg font-semibold transition disabled:opacity-50"
            style={{ background: "#EC1E8C" }}
          >
            {spinning ? "Spinning…" : done ? "Thanks for playing!" : "Spin the wheel"}
          </button>

          {message && (
            <p
              className="mt-4 text-center text-[15px] font-medium"
              style={{ color: messageTone === "win" ? "#6FA713" : messageTone === "error" ? "#c0392b" : "#1FA9E0" }}
              role="status"
            >
              {message}
            </p>
          )}
          <p className="mt-3 text-center text-[11px] text-buzz-mute leading-relaxed">
            One spin per day · confirm your email to claim · winners drawn from confirmed entries
          </p>
        </div>
      </div>

      {/* Right: the wheel */}
      <div className="relative w-[300px] h-[300px] mx-auto shrink-0">
        <div
          aria-hidden
          className="absolute left-1/2 -translate-x-1/2 z-10"
          style={{ top: -6, width: 0, height: 0, borderLeft: "15px solid transparent", borderRight: "15px solid transparent", borderTop: "26px solid #16202A" }}
        />
        <div
          className="w-[300px] h-[300px] rounded-full relative box-border"
          style={{
            border: "8px solid #fff",
            background: conicGradient(slices),
            transform: `rotate(${rotation}deg)`,
            transition: "transform 4.4s cubic-bezier(.13,.86,.24,1)",
            boxShadow: "0 8px 24px rgba(22,32,42,.15)",
          }}
        >
          {slices.map((s, i) => {
            const a = i * step + step / 2;
            return (
              <div key={i} className="absolute left-1/2 top-1/2" style={{ transformOrigin: "0 0", transform: `rotate(${a}deg)` }}>
                <div
                  className="absolute whitespace-nowrap font-semibold"
                  style={{ transform: "translate(-50%,0) rotate(90deg)", left: 108, top: -8, fontSize: 11, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,.4)" }}
                >
                  {s.label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Bee hub — sits above the wheel and stays upright while it spins */}
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white grid place-items-center overflow-hidden z-20"
          style={{ width: 68, height: 68, boxShadow: "0 2px 8px rgba(22,32,42,.2)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.png" alt="" width={56} height={56} style={{ objectFit: "contain" }} />
        </div>
      </div>
    </div>
  );
}
