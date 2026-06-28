"use client";

import { useState } from "react";
import { WhatsAppIcon, XIcon, FacebookIcon, LinkIcon, CheckIcon } from "./SocialIcons";

export default function ShareButtons({
  url,
  title,
  size = "md",
}: {
  url: string;
  title: string;
  size?: "sm" | "md";
}) {
  const [copied, setCopied] = useState(false);

  const text = encodeURIComponent(title);
  const enc = encodeURIComponent(url);

  const links = {
    whatsapp: `https://wa.me/?text=${text}%20${enc}`,
    twitter: `https://twitter.com/intent/tweet?text=${text}&url=${enc}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${enc}`,
  };

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  const btn =
    size === "sm"
      ? "inline-flex items-center justify-center w-9 h-9 rounded-full bg-buzz-card border border-buzz-border hover:border-buzz-accent hover:text-buzz-accent transition"
      : "inline-flex items-center gap-2 rounded-lg bg-buzz-card border border-buzz-border hover:border-buzz-accent hover:text-buzz-accent transition px-3 py-2 text-sm";

  const iconSize = size === "sm" ? 16 : 16;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-buzz-mute uppercase tracking-wider mr-1">Share</span>
      <a
        href={links.whatsapp}
        target="_blank"
        rel="noreferrer"
        aria-label="Share on WhatsApp"
        className={btn}
        title="WhatsApp"
      >
        <WhatsAppIcon size={iconSize} />
        {size === "md" && <span>WhatsApp</span>}
      </a>
      <a
        href={links.twitter}
        target="_blank"
        rel="noreferrer"
        aria-label="Share on X"
        className={btn}
        title="X"
      >
        <XIcon size={iconSize} />
        {size === "md" && <span>X</span>}
      </a>
      <a
        href={links.facebook}
        target="_blank"
        rel="noreferrer"
        aria-label="Share on Facebook"
        className={btn}
        title="Facebook"
      >
        <FacebookIcon size={iconSize} />
        {size === "md" && <span>Facebook</span>}
      </a>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy link"
        className={btn}
        title="Copy link"
      >
        {copied ? <CheckIcon size={iconSize} /> : <LinkIcon size={iconSize} />}
        {size === "md" && <span>{copied ? "Copied" : "Copy link"}</span>}
      </button>
    </div>
  );
}
