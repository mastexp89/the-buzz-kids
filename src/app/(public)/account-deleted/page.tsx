import Link from "next/link";

export const metadata = {
  title: "Account deleted — The Buzz Kids",
  description: "Your account has been deleted from The Buzz Guide.",
};

export default function AccountDeletedPage() {
  return (
    <div className="container-page py-20 max-w-xl text-center">
      <div className="text-6xl mb-4">🗑️</div>
      <h1 className="h-display text-4xl sm:text-5xl mb-3">Account deleted</h1>
      <p className="text-buzz-mute mb-8">
        Your account, profile, places, events and uploaded media have been permanently
        removed from The Buzz Kids. Stripe transaction records (if any) are retained for
        legal compliance — see our{" "}
        <Link href="/delete-account" className="text-buzz-accent hover:text-buzz-accent2">
          deletion policy
        </Link>{" "}
        for details.
      </p>
      <p className="text-buzz-mute mb-8">
        Thank you for using The Buzz Kids.
      </p>
      <div className="flex gap-3 justify-center flex-wrap">
        <Link href="/" className="btn-primary">Back to home</Link>
        <Link href="/signup" className="btn-secondary">Create a new account</Link>
      </div>
    </div>
  );
}
