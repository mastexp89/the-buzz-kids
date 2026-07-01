"use client";

// "Tell us about your place" lead form for /list-your-activity. Replaces the
// old owner account signup: businesses no longer create an account + manage a
// dashboard — they send us the details and we get the listing up (and keep it
// accurate for them). Lands in the admin edit_suggestions queue as a new_place.

import { useState } from "react";
import Link from "next/link";
import { submitPlaceLead, uploadSuggestionImage } from "@/lib/edit-suggestion-actions";

export default function PlaceLeadForm() {
  const [placeName, setPlaceName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [details, setDetails] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onFile(file: File) {
    setErrorMsg(null);
    setUploading(true);
    const dataUrl: string = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsDataURL(file);
    });
    const out = await uploadSuggestionImage(dataUrl, file.name);
    setUploading(false);
    if (out.error) { setErrorMsg(out.error); return; }
    if (out.imageUrl) setImageUrl(out.imageUrl);
  }

  if (state === "done") {
    return (
      <div className="card p-6">
        <h2 className="h-display text-2xl mb-2">Got it — thank you! 🐝</h2>
        <p className="text-buzz-mute mb-4">
          We&apos;ll get {placeName || "your place"} added and drop you a line if we need
          anything. Listings are free and we keep the details accurate for you.
        </p>
        <Link href="/browse" className="btn-secondary">Browse the directory →</Link>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    setErrorMsg(null);
    const res = await submitPlaceLead({ placeName, details, contactName: name, contactEmail: email, imageUrl });
    if (res.error) {
      setErrorMsg(res.error);
      setState("error");
      return;
    }
    setState("done");
  }

  return (
    <form onSubmit={submit} className="card p-6 flex flex-col gap-4">
      <div>
        <label className="label">Name of your place *</label>
        <input
          className="input"
          required
          value={placeName}
          onChange={(e) => setPlaceName(e.target.value)}
          placeholder="e.g. Adventure Planet Soft Play, Dundee"
          maxLength={200}
        />
      </div>
      <div>
        <label className="label">Tell us about it</label>
        <textarea
          className="input min-h-[110px]"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="What is it, where is it, ages it suits, opening times, website / social links, prices — whatever you've got."
          maxLength={2000}
        />
      </div>
      <div>
        <label className="label">Poster or photo <span className="text-buzz-mute font-normal">(optional)</span></label>
        {imageUrl ? (
          <div className="flex items-center gap-3">
            <img src={imageUrl} alt="Your upload" className="h-24 rounded-lg border border-buzz-border object-contain bg-buzz-surface" />
            <button type="button" onClick={() => setImageUrl("")} className="btn-secondary text-sm">Remove</button>
          </div>
        ) : (
          <>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
              className="text-sm"
            />
            {uploading && <span className="text-xs text-buzz-accent ml-2">Uploading…</span>}
          </>
        )}
        <p className="help !mt-1">A flyer, logo or photo of the place — helps us set it up faster.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Your name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} placeholder="So we can confirm it's live" />
        </div>
      </div>

      {state === "error" && errorMsg && <p className="text-sm text-rose-500">{errorMsg}</p>}

      <button type="submit" className="btn-primary" disabled={state === "busy" || uploading}>
        {state === "busy" ? "Sending…" : uploading ? "Uploading image…" : "Send it in — it's free"}
      </button>
      <p className="help !mt-0">Free to list, free forever. We&apos;ll add it and keep the details right for you.</p>
    </form>
  );
}
