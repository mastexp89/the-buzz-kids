import { createClient } from "@/lib/supabase/server";
import VenueForm from "../VenueForm";

export const dynamic = "force-dynamic";

export default async function NewVenuePage() {
  const supabase = await createClient();
  const [{ data: cities }, { data: genres }] = await Promise.all([
    supabase.from("cities").select("*").eq("active", true).order("name"),
    supabase.from("genres").select("*").order("name"),
  ]);

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <p className="eyebrow mb-1">New place</p>
        <h1 className="h-display text-4xl">Add your place</h1>
        <p className="text-buzz-mute mt-2">
          Fill this in and we'll review it within 24 hours. Once approved, it'll appear in the directory.
        </p>
      </div>
      <VenueForm venue={null} cities={cities ?? []} categories={genres ?? []} />
    </div>
  );
}
