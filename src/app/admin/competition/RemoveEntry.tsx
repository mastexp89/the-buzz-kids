"use client";

import { removeCircusEntry } from "@/lib/competition-actions";

export default function RemoveEntry({ userId, name }: { userId: string; name: string }) {
  return (
    <form
      action={removeCircusEntry}
      className="shrink-0"
      onSubmit={(e) => {
        if (!confirm(`Remove ${name || "this entrant"} from the draw?`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="user_id" value={userId} />
      <button className="text-xs text-red-600 hover:underline px-1" title="Remove from the draw">
        Remove
      </button>
    </form>
  );
}
