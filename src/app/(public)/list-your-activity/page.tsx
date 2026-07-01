import Link from "next/link";
import PlaceLeadForm from "@/components/PlaceLeadForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "List your activity — The Buzz Kids",
  description:
    "List your soft play, club, class, farm or holiday camp on The Buzz Kids — free. Reach local families looking for things to do.",
  alternates: { canonical: "/list-your-activity" },
};

export default function ListYourActivityPage() {
  return (
    <div className="container-page py-12 max-w-2xl">
      <p className="eyebrow mb-1">For clubs, places &amp; activity providers</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-3">
        List your activity<span className="text-buzz-accent">.</span>
      </h1>
      <p className="text-buzz-mute mb-6 max-w-xl">
        Free to list. Tell us about your place — soft play, club, class, farm or holiday
        camp — and we&apos;ll get it up on The Buzz Kids and keep the details accurate for you.
        No account to set up: just send it in.
      </p>

      <PlaceLeadForm />

      <p className="text-sm text-buzz-mute mt-6">
        Already on The Buzz Kids? Find your place and use{" "}
        <strong className="text-buzz-text">“Suggest an edit”</strong> on its page to send
        updates, or{" "}
        <Link href="/browse" className="text-buzz-accent hover:underline">browse the directory</Link>.
      </p>
    </div>
  );
}
