// Shared HTML email wrapper for The Buzz Kids.
//
// Email clients are notoriously picky:
//   - Inline styles (a <style> block is progressive enhancement only).
//   - Tables, not flexbox / grid (Outlook ignores most modern CSS).
//   - 600px max width. No external CSS.
//
// Brand (bright / family):
//   page #eaf4fb  card #ffffff  border #dbebf5  text #16202A
//   mute #647682  accent #1FA9E0

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.thebuzzkids.co.uk";
const LOGO_URL = `${SITE}/logo.png`;

export type EmailBlock =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "kv"; pairs: Array<[string, string | null | undefined]> }
  | { kind: "button"; href: string; text: string }
  | { kind: "small"; text: string };

/**
 * Wrap a list of blocks in the standard Buzz Kids email shell (logo header +
 * bright body + footer). Returns ready-to-send HTML. Pass `unsubscribeUrl` for
 * marketing / newsletter sends so recipients get a one-click unsubscribe.
 */
export function buildEmailHtml(opts: {
  preheader?: string;
  blocks: EmailBlock[];
  unsubscribeUrl?: string;
}): string {
  const { preheader = "", blocks, unsubscribeUrl } = opts;

  const bodyHtml = blocks.map(renderBlock).join("\n");

  const footerNote = unsubscribeUrl
    ? `You're receiving this because you signed up to The Buzz Kids.<br />
       <a href="${escapeAttr(unsubscribeUrl)}" style="color:#647682;text-decoration:underline;">Unsubscribe</a> ·
       <a href="${SITE}" style="color:#1FA9E0;text-decoration:none;">thebuzzkids.co.uk</a>`
    : `You're receiving this because of activity on your account at
       <a href="${SITE}" style="color:#1FA9E0;text-decoration:none;">thebuzzkids.co.uk</a>.`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>The Buzz Kids</title>
  </head>
  <body style="margin:0;padding:0;background:#eaf4fb;color:#16202A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#eaf4fb;opacity:0;">${escapeHtml(preheader)}</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eaf4fb;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #dbebf5;border-radius:16px;overflow:hidden;">
            <!-- Header / logo -->
            <tr>
              <td align="center" style="padding:26px 24px 18px 24px;background:#ffffff;border-bottom:1px solid #eef6fb;">
                <a href="${SITE}" style="text-decoration:none;">
                  <img src="${LOGO_URL}" alt="The Buzz Kids" width="72" height="72" style="display:block;border:0;outline:none;text-decoration:none;height:72px;width:72px;" />
                </a>
                <div style="margin-top:8px;color:#647682;font-size:12px;letter-spacing:0.02em;">Things to do with the kids across Scotland</div>
              </td>
            </tr>
            <!-- Body -->
            <tr>
              <td style="padding:26px 28px 20px 28px;color:#16202A;font-size:15px;line-height:1.55;">
                ${bodyHtml}
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="padding:18px 24px 22px 24px;background:#f4f9fc;border-top:1px solid #dbebf5;color:#647682;font-size:12px;line-height:1.6;text-align:center;">
                ${footerNote}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderBlock(block: EmailBlock): string {
  switch (block.kind) {
    case "h":
      return `<h2 style="margin:0 0 14px 0;font-family:Impact,'Helvetica Neue',sans-serif;font-size:24px;line-height:1.15;color:#16202A;text-transform:uppercase;letter-spacing:0.01em;">${escapeHtml(block.text)}</h2>`;
    case "p":
      return `<p style="margin:0 0 14px 0;color:#16202A;font-size:15px;line-height:1.6;">${escapeHtml(block.text)}</p>`;
    case "small":
      return `<p style="margin:0 0 12px 0;color:#647682;font-size:13px;line-height:1.5;">${escapeHtml(block.text)}</p>`;
    case "kv": {
      const rows = block.pairs
        .filter(([, v]) => v != null && String(v).length > 0)
        .map(
          ([k, v]) => `
        <tr>
          <td style="padding:6px 12px 6px 0;color:#647682;font-size:13px;width:120px;vertical-align:top;">${escapeHtml(k)}</td>
          <td style="padding:6px 0;color:#16202A;font-size:14px;vertical-align:top;">${escapeHtml(String(v))}</td>
        </tr>`,
        )
        .join("");
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;border-collapse:collapse;width:100%;border-top:1px solid #dbebf5;border-bottom:1px solid #dbebf5;">${rows}</table>`;
    }
    case "button":
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px 0;">
        <tr>
          <td align="left">
            <a href="${escapeAttr(block.href)}" style="display:inline-block;background:#1FA9E0;color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;padding:12px 22px;border-radius:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(block.text)} →</a>
          </td>
        </tr>
      </table>`;
  }
}

/**
 * Render the same blocks as plain text for the text/plain fallback.
 */
export function buildEmailText(blocks: EmailBlock[], unsubscribeUrl?: string): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.kind === "h") {
      lines.push(block.text.toUpperCase(), "");
    } else if (block.kind === "p" || block.kind === "small") {
      lines.push(block.text, "");
    } else if (block.kind === "kv") {
      for (const [k, v] of block.pairs) {
        if (v == null || String(v).length === 0) continue;
        lines.push(`${k}: ${v}`);
      }
      lines.push("");
    } else if (block.kind === "button") {
      lines.push(`${block.text}: ${block.href}`, "");
    }
  }
  lines.push("— The Buzz Kids");
  if (unsubscribeUrl) lines.push(`Unsubscribe: ${unsubscribeUrl}`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
