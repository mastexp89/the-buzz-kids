// Signed unsubscribe links — no DB token needed. We HMAC the email with a
// server secret so a link can be verified without storing anything, and nobody
// can unsubscribe an address they don't hold a valid link for.
import crypto from "crypto";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.thebuzzkids.co.uk";

function secret(): string {
  return process.env.RESEND_API_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "buzz-kids-unsub-fallback";
}

export function unsubToken(email: string): string {
  return crypto.createHmac("sha256", secret()).update(email.trim().toLowerCase()).digest("base64url").slice(0, 24);
}

export function unsubUrl(email: string): string {
  return `${SITE}/unsubscribe?e=${encodeURIComponent(email)}&t=${unsubToken(email)}`;
}

export function verifyUnsub(email: string, token: string): boolean {
  if (!email || !token) return false;
  const expected = unsubToken(email);
  // Constant-time compare.
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}
