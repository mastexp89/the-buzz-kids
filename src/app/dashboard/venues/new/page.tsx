import { createClient } from "@/lib/supabase/server";
import VenueForm from "../VenueForm";

export const dynamic = "force-dynamic";

export default async function NewVenuePage() {
  const supabase = await createClient();
  const { data: cities } = await supabase
    .from("cities")
    .select("*")
    .eq("active", true)
    .order("name");

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <p className="eyebrow mb-1">New venue</p>
        <h1 className="h-display text-4xl">Add a venue</h1>
        <p className="text-buzz-mute mt-2">
          Fill this in and we'll review it within 24 hours. Once approved, you can post gigs.
        </p>
      </div>
      <VenueForm venue={null} cities={cities ?? []} />
    </div>
  );
}
