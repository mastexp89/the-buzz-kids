// Shared HTML email wrapper for The Buzz Guide.
//
// Email clients are notoriously picky:
//   - Stick to inline styles (no <style> blocks rely on; we still include one
//     for clients that DO support it as a progressive enhancement, but every
//     critical style is also inlined on its element).
//   - Tables, not flexbox / grid (Outlook ignores most modern CSS).
//   - 600px max width.
//   - No external CSS.
//
// Brand:
//   bg     #000000   honey-gold accent #fdb913   text #f5f5f0
//   card   #161618   border           #26262a   mute #8a8a92

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.thebuzzkids.co.uk";
const LOGO_URL = `${SITE}/logo.png`;

export type EmailBlock =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "kv"; pairs: Array<[string, string | null | undefined]> }
  | { kind: "button"; href: string; text: string }
  | { kind: "small"; text: string };

/**
 * Wrap a list of blocks in the standard Buzz email shell (logo header +
 * dark body + footer). Returns ready-to-send HTML.
 */
export function buildEmailHtml(opts: {
  preheader?: string;
  blocks: EmailBlock[];
}): string {
  const { preheader = "", blocks } = opts;

  const bodyHtml = blocks.map(renderBlock).join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <meta name="supported-color-schemes" content="dark light" />
    <title>The Buzz Guide</title>
  </head>
  <body style="margin:0;padding:0;background:#000000;color:#f5f5f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <!-- Preheader (preview text in inbox lists). -->
    <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#000;opacity:0;">${escapeHtml(preheader)}</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#000000;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <!-- Container -->
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#161618;border:1px solid #26262a;border-radius:16px;overflow:hidden;">
            <!-- Header / logo -->
            <tr>
              <td align="center" style="padding:28px 24px 20px 24px;background:#000000;border-bottom:1px solid #26262a;">
                <a href="${SITE}" style="text-decoration:none;color:#fdb913;">
                  <img src="${LOGO_URL}" alt="The Buzz Guide" width="64" height="64" style="display:block;border:0;outline:none;text-decoration:none;height:64px;width:64px;border-radius:14px;" />
                </a>
                <div style="margin-top:10px;font-family:Impact,'Helvetica Neue',sans-serif;font-size:24px;letter-spacing:0.04em;color:#f5f5f0;text-transform:uppercase;">
                  The Buzz Guide<span style="color:#fdb913;">.</span>
                </div>
              </td>
            </tr>
            <!-- Body -->
            <tr>
              <td style="padding:28px 28px 20px 28px;color:#f5f5f0;font-size:15px;line-height:1.55;">
                ${bodyHtml}
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="padding:18px 24px 22px 24px;background:#0e0e10;border-top:1px solid #26262a;color:#8a8a92;font-size:12px;line-height:1.5;text-align:center;">
                You're receiving this because of activity on your account at
                <a href="${SITE}" style="color:#fdb913;text-decoration:none;">thebuzzkids.co.uk</a>.<br />
                <span style="color:#5a5a62;">Things to do with the kids across Scotland.</span>
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
      return `<h2 style="margin:0 0 14px 0;font-family:Impact,'Helvetica Neue',sans-serif;font-size:22px;line-height:1.2;color:#f5f5f0;">${escapeHtml(block.text)}</h2>`;
    case "p":
      return `<p style="margin:0 0 14px 0;color:#f5f5f0;font-size:15px;line-height:1.55;">${escapeHtml(block.text)}</p>`;
    case "small":
      return `<p style="margin:0 0 12px 0;color:#8a8a92;font-size:13px;line-height:1.5;">${escapeHtml(block.text)}</p>`;
    case "kv": {
      const rows = block.pairs
        .filter(([, v]) => v != null && String(v).length > 0)
        .map(
          ([k, v]) => `
        <tr>
          <td style="padding:6px 12px 6px 0;color:#8a8a92;font-size:13px;width:120px;vertical-align:top;">${escapeHtml(k)}</td>
          <td style="padding:6px 0;color:#f5f5f0;font-size:14px;vertical-align:top;">${escapeHtml(String(v))}</td>
        </tr>`,
        )
        .join("");
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;border-collapse:collapse;width:100%;border-top:1px solid #26262a;border-bottom:1px solid #26262a;">${rows}</table>`;
    }
    case "button":
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px 0;">
        <tr>
          <td align="left">
            <a href="${escapeAttr(block.href)}" style="display:inline-block;background:#fdb913;color:#000000;font-weight:600;font-size:14px;text-decoration:none;padding:11px 20px;border-radius:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(block.text)} →</a>
          </td>
        </tr>
      </table>`;
  }
}

/**
 * Helper: render the same blocks as plain text, used as the text/plain
 * fallback so spam filters and text-only clients still get the message.
 */
export function buildEmailText(blocks: EmailBlock[]): string {
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
