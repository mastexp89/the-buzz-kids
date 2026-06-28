"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setReviewStatus } from "@/lib/reviews-actions";

export default function ReviewModeration({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (s: "approved" | "hidden" | "pending") =>
    start(async () => {
      await setReviewStatus(id, s);
      router.refresh();
    });

  return (
    <div className="flex flex-wrap gap-2">
      {status !== "approved" && (
        <button onClick={() => set("approved")} disabled={pending} className="btn-primary text-xs">
          ✓ Approve
        </button>
      )}
      {status !== "hidden" && (
        <button onClick={() => set("hidden")} disabled={pending} className="btn-secondary text-xs">
          Hide
        </button>
      )}
      {status === "hidden" && (
        <button onClick={() => set("pending")} disabled={pending} className="btn-secondary text-xs">
          Un-hide
        </button>
      )}
    </div>
  );
}
