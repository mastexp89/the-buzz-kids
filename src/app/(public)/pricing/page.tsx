import { redirect } from "next/navigation";

// The Buzz Guide is now free for venues and artists.
// Anything that used to live here is replaced by the Advertise page (boosts +
// promos for venues / artists, plus paid ad slots for outside companies).
export default function PricingPage() {
  redirect("/advertise");
}
