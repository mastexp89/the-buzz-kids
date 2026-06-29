import { createClient } from "@/lib/supabase/server";
import SubmitOfferForm from "./SubmitOfferForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Suggest a deal — The Buzz Kids",
  description: "Know a kids-eat-free or cheap-days-out deal anywhere in Scotland? Tell us and we'll add it.",
  alternates: { canonical: "/submit-offer" },
};

export default async function SubmitOfferPage() {
  const supabase = await createClient();
  const { data: cities } = await supabase.from("cities").select("name, slug").eq("active", true).order("name");

  return (
    <div className="container-page py-12 max-w-2xl">
      <p className="eyebrow mb-1">Help other parents</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-3">Know a deal? Tell us.</h1>
      <p className="text-buzz-mute mb-6 max-w-xl">
        Spotted a "kids eat free", "kids for £1" or family days-out offer near you?
        Send it in — no account needed. We'll check it and add it to the Deals or Food tab.
      </p>
      <SubmitOfferForm cities={cities ?? []} />
    </div>
  );
}
