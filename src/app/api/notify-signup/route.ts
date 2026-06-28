import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(req: NextRequest) {
  let email: string;
  try {
    const body = await req.json();
    email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  const sb = createServiceClient();
  const { error } = await sb
    .from("notify_signups")
    .upsert({ email }, { onConflict: "email", ignoreDuplicates: true });

  if (error) {
    console.error("notify_signups insert error:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  // Notify Dylan so he knows someone signed up.
  const resendKey = process.env.RESEND_API_KEY;
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL;
  const from = process.env.ADMIN_NOTIFY_FROM ?? "The Buzz Kids <noreply@thebuzzkids.co.uk>";
  if (resendKey && adminEmail) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from,
          to: [adminEmail],
          subject: `New coming-soon signup: ${email}`,
          text: `Someone signed up to be notified when The Buzz Kids launches:\n\n${email}`,
        }),
      });
    } catch {
      // Non-fatal — email is already saved to the DB.
    }
  }

  return NextResponse.json({ ok: true });
}
