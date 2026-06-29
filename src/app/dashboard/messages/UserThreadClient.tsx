"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendMyMessage, type Message } from "@/lib/messages-actions";

export default function UserThreadClient({
  initialMessages,
}: {
  initialMessages: Message[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!body.trim()) return;
    start(async () => {
      const r = await sendMyMessage(body);
      if ("error" in r) setError(r.error);
      else { setBody(""); router.refresh(); }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {initialMessages.length === 0 ? (
          <div className="card p-6 text-center text-buzz-mute">
            No messages yet — say hello below.
          </div>
        ) : (
          initialMessages.map((m) => <Bubble key={m.id} message={m} />)
        )}
      </div>

      <form onSubmit={send} className="card p-4 flex flex-col gap-2">
        <label className="label">Send a message</label>
        <textarea
          className="input min-h-[100px]"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={5000}
          placeholder="Hi…"
        />
        {error && <div className="text-sm text-rose-400">{error}</div>}
        <div className="flex gap-2 items-center">
          <button type="submit" disabled={pending || !body.trim()} className="btn-primary">
            {pending ? "Sending…" : "Send"}
          </button>
          <span className="text-xs text-buzz-mute">{body.length} / 5000</span>
        </div>
      </form>
    </div>
  );
}

function Bubble({ message }: { message: Message }) {
  const fromThem = message.from_admin;
  return (
    <div className={`flex ${fromThem ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          fromThem
            ? "bg-buzz-card border border-buzz-border rounded-bl-sm"
            : "bg-buzz-accent text-black rounded-br-sm"
        }`}
      >
        <div className="whitespace-pre-line text-sm leading-relaxed">{message.body}</div>
        <div className={`text-[10px] mt-1 ${fromThem ? "text-buzz-mute" : "text-black/60"}`}>
          {fromThem ? "The Buzz Kids" : "You"} ·{" "}
          {new Date(message.created_at).toLocaleString("en-GB", {
            day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}
