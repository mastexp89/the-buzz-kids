// Inbound email handler — REMOVED.
//
// We pivoted to a magic-link "Reply on The Buzz Guide" button in notification emails
// instead of inbound email parsing. This route is intentionally a stub.
// Safe to delete the folder if you want.

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Inbound email handler removed. Use the 'Reply on The Buzz Guide' button in notification emails." },
    { status: 410 },
  );
}
