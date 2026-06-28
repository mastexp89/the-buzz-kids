import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Format a Date as iCal UTC stamp: 20260509T190000Z
function icsDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function escapeICS(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select(`*, venue:venues!inner(name, address, postcode, city:cities!inner(name, slug), approved)`)
    .eq("id", id)
    .single();

  if (!event || !(event.venue as any).approved) {
    return new NextResponse("Not found", { status: 404 });
  }
  if ((event as any).status && (event as any).status !== "approved") {
    return new NextResponse("Not found", { status: 404 });
  }

  const venue = event.venue as any;
  const start = new Date(event.start_time);
  const end = event.end_time
    ? new Date(event.end_time)
    : new Date(start.getTime() + 3 * 60 * 60 * 1000); // default 3h
  const now = new Date();

  const location = [venue.name, venue.address, venue.postcode, venue.city?.name, "UK"]
    .filter(Boolean)
    .join(", ");

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://thebuzzguide.co.uk";
  const eventUrl = `${siteUrl}/${venue.city.slug}/events/${event.id}`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//The Buzz Guide//Live Music//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.id}@thebuzzguide.co.uk`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${escapeICS(event.title)}`,
    `LOCATION:${escapeICS(location)}`,
    `DESCRIPTION:${escapeICS(event.description ?? "")}\\n\\nMore info: ${eventUrl}`,
    `URL:${eventUrl}`,
    event.cancelled ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  const ics = lines.join("\r\n");
  const filename = (event.title || "gig").replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".ics";

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
