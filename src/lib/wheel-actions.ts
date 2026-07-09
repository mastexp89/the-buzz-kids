"use server";

import { headers } from "next/headers";
import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { expandSlices, type WheelPrize } from "@/lib/wheel";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.thebuzzkids.co.uk";
const IP_SALT = process.env.WHEEL_IP_SALT ?? "buzzkids-wheel";

function londonToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

async function clientIpHash(): Promise<string | null> {
  const h = await headers();
  const raw = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "";
  if (!raw) return null;
  return crypto.createHash("sha256").update(IP_SALT + raw).digest("hex");
}

export type SpinResult =
  | { ok: true; sliceIndex: number; label: string; kind: "entry" | "real"; needsConfirm: boolean; entries: number }
  | { ok: false; reason: "inactive" | "closed" | "already_email" | "already_ip" | "invalid" | "error"; message: string; entries?: number };

export async function spinWheel(email: string, consent: boolean): Promise<SpinResult> {
  const clean = (email ?? "").trim().toLowerCase();
  if (!consent) return { ok: false, reason: "invalid", message: "Please tick the box to agree before spinning." };
  if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean))
    return { ok: false, reason: "invalid", message: "Please enter a valid email address." };

  const sb = createServiceClient();

  try {
    // --- campaign must be live ---
    const { data: cfg } = await sb.from("wheel_config").select("active, closes_on").eq("id", 1).maybeSingle();
    if (!cfg?.active) return { ok: false, reason: "inactive", message: "There's no competition running right now — check back soon!" };
    const today = londonToday();
    if (cfg.closes_on && cfg.closes_on < today)
      return { ok: false, reason: "closed", message: "This competition has now closed. Thanks for playing!" };

    // --- one spin per email per day ---
    const { data: emailSpin } = await sb
      .from("wheel_spins").select("id").eq("email", clean).eq("spun_on", today).maybeSingle();
    if (emailSpin) {
      const entries = await entryCountFor(sb, clean);
      return { ok: false, reason: "already_email", message: "You've already spun today — come back tomorrow for another go!", entries };
    }

    // --- one spin per IP per day ---
    const ipHash = await clientIpHash();
    if (ipHash) {
      const { data: ipSpin } = await sb
        .from("wheel_spins").select("id").eq("ip_hash", ipHash).eq("spun_on", today).limit(1).maybeSingle();
      if (ipSpin)
        return { ok: false, reason: "already_ip", message: "Looks like this device has already spun today — come back tomorrow!" };
    }

    // --- pick a slice (server-authoritative, weighted by slots) ---
    const { data: prizes } = await sb
      .from("wheel_prizes").select("id, label, kind, slots, color, sort, active").eq("active", true);
    const slices = expandSlices((prizes ?? []) as WheelPrize[]);
    if (slices.length === 0) return { ok: false, reason: "error", message: "The wheel isn't set up yet — please try again later." };
    const sliceIndex = crypto.randomInt(0, slices.length);
    const won = slices[sliceIndex];

    // --- record the spin ---
    const { error: insErr } = await sb.from("wheel_spins").insert({
      email: clean, ip_hash: ipHash, prize_id: won.prizeId, prize_label: won.label, prize_kind: won.kind, spun_on: today,
    });
    if (insErr) {
      // Unique(email, spun_on) race → treat as already-spun.
      if ((insErr as any).code === "23505") {
        const entries = await entryCountFor(sb, clean);
        return { ok: false, reason: "already_email", message: "You've already spun today — come back tomorrow!", entries };
      }
      throw insErr;
    }

    // --- double opt-in: confirm once ---
    const { data: signup } = await sb
      .from("notify_signups").select("email, confirmed").eq("email", clean).maybeSingle();
    let needsConfirm = false;
    if (!signup || !signup.confirmed) {
      needsConfirm = true;
      const token = crypto.randomUUID();
      await sb.from("notify_signups").upsert(
        { email: clean, confirmed: false, confirm_token: token },
        { onConflict: "email" },
      );
      await sendConfirmEmail(clean, token, won.label, won.kind);
    }

    const entries = needsConfirm ? 0 : await entryCountFor(sb, clean);
    return { ok: true, sliceIndex, label: won.label, kind: won.kind, needsConfirm, entries };
  } catch (e) {
    console.error("spinWheel error:", e);
    return { ok: false, reason: "error", message: "Something went wrong — please try again." };
  }
}

// How many confirmed draw entries this email currently holds (all draws).
async function entryCountFor(sb: ReturnType<typeof createServiceClient>, email: string): Promise<number> {
  const { data: s } = await sb.from("notify_signups").select("confirmed").eq("email", email).maybeSingle();
  if (!s?.confirmed) return 0;
  const { count } = await sb
    .from("wheel_spins").select("id", { count: "exact", head: true }).eq("email", email).eq("prize_kind", "entry");
  return count ?? 0;
}

async function sendConfirmEmail(email: string, token: string, prizeLabel: string, kind: "entry" | "real") {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.ADMIN_NOTIFY_FROM ?? "The Buzz Kids <noreply@thebuzzkids.co.uk>";
  if (!key) return;
  const link = `${SITE_URL}/win/confirm?token=${token}`;
  const claim = kind === "entry"
    ? `lock in your <strong>${prizeLabel}</strong> and any future entries`
    : `claim your <strong>${prizeLabel}</strong>`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Confirm your entry — The Buzz Kids 🎪",
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#16202A">
          <h2 style="color:#EC1E8C">You're nearly in! 🎪</h2>
          <p>Thanks for spinning the Buzz Kids wheel. Tap below to confirm your email — then we can ${claim}.</p>
          <p style="margin:24px 0"><a href="${link}" style="background:#EC1E8C;color:#fff;text-decoration:none;padding:12px 22px;border-radius:12px;font-weight:600">Confirm my email</a></p>
          <p style="font-size:13px;color:#6b7280">You'll then be able to spin once a day for more entries. If you didn't do this, just ignore this email.</p>
        </div>`,
        text: `You're nearly in! Confirm your email to ${kind === "entry" ? `lock in your ${prizeLabel}` : `claim your ${prizeLabel}`}: ${link}`,
      }),
    });
  } catch {
    // Non-fatal — the spin is already recorded; they can spin again tomorrow.
  }
}
