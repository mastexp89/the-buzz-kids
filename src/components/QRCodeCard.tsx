"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

export default function QRCodeCard({
  url,
  label,
  filenameBase = "the-buzz-qr",
}: {
  url: string;
  label: string;
  filenameBase?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, url, {
      width: 480,
      margin: 2,
      color: { dark: "#000000", light: "#fdb913" }, // honey background, black dots
    }).catch(() => {});
    QRCode.toDataURL(url, {
      width: 1024,
      margin: 2,
      color: { dark: "#000000", light: "#fdb913" },
    })
      .then(setDataUrl)
      .catch(() => {});
  }, [url]);

  function download() {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${filenameBase}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function print() {
    if (!dataUrl) return;
    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) return;
    w.document.write(`
      <html><head><title>${filenameBase} — print</title>
      <style>
        body { display:flex; flex-direction:column; align-items:center; gap:20px; font-family:-apple-system,sans-serif; padding:40px; }
        img { width: 320px; height: 320px; border-radius: 16px; }
        h1 { font-size: 28px; margin: 0; }
        p { color: #666; margin: 0; font-size: 14px; }
      </style>
      </head><body>
        <h1>${label}</h1>
        <img src="${dataUrl}" alt="QR code" />
        <p>${url}</p>
        <p style="font-size:12px;font-style:italic;">Scan for what's on · The Buzz Guide</p>
        <script>window.onload=()=>{setTimeout(()=>window.print(),200);}</script>
      </body></html>
    `);
    w.document.close();
  }

  return (
    <div className="card p-5 flex flex-col sm:flex-row gap-5 items-start">
      <canvas ref={canvasRef} className="rounded-xl shrink-0 w-40 h-40 sm:w-48 sm:h-48" />
      <div className="flex-1 min-w-0">
        <p className="eyebrow text-[10px] mb-1">QR code</p>
        <h3 className="font-display text-xl uppercase mb-1">Promote your venue page</h3>
        <p className="text-sm text-buzz-mute mb-3">
          Print this on flyers, table-talkers, posters, or stick it next to the bar. Customers scan to see
          everything you've got coming up.
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={download} disabled={!dataUrl} className="btn-secondary">⬇ Download PNG</button>
          <button onClick={print} disabled={!dataUrl} className="btn-secondary">🖨 Print poster</button>
        </div>
        <p className="help mt-2 break-all">
          Links to: <span className="text-buzz-text">{url}</span>
        </p>
      </div>
    </div>
  );
}
