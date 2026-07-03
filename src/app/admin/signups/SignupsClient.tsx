"use client";

import { useMemo, useState } from "react";

type Signup = { email: string; created_at: string };

export default function SignupsClient({ signups }: { signups: Signup[] }) {
  const [copied, setCopied] = useState(false);
  const emails = useMemo(() => signups.map((s) => s.email), [signups]);

  function copyAll() {
    navigator.clipboard.writeText(emails.join(", ")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function downloadCsv() {
    const rows = [["email", "signed_up"], ...signups.map((s) => [s.email, s.created_at])];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "buzz-kids-signups.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (signups.length === 0) {
    return <div className="card p-6 text-buzz-mute text-sm">No signups yet.</div>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="font-display text-2xl">{signups.length}</span>
        <span className="text-buzz-mute text-sm">email{signups.length === 1 ? "" : "s"} on the list</span>
        <div className="ml-auto flex gap-2">
          <button onClick={copyAll} className="btn-secondary text-sm">{copied ? "Copied ✓" : "Copy all emails"}</button>
          <button onClick={downloadCsv} className="btn-secondary text-sm">Download CSV</button>
        </div>
      </div>
      <ul className="card divide-y divide-buzz-border/60">
        {signups.map((s, i) => (
          <li key={s.email + i} className="p-3 flex items-center justify-between gap-3 text-sm">
            <a href={`mailto:${s.email}`} className="text-buzz-accent hover:underline break-all">{s.email}</a>
            <span className="text-xs text-buzz-mute shrink-0">
              {new Date(s.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
