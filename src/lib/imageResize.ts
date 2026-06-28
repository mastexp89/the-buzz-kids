// Client-side image downscaling + recompression.
// Big phone photos (5MB+) get crushed to ~150-300KB without visible quality loss.
//
// We render the source image into a canvas at the target max dimensions,
// then export as JPEG (or PNG if the source had transparency).
//
// CRITICAL: this function must NEVER throw. If anything goes wrong (HEIC files
// browsers can't decode, oversized images, canvas tainted, etc.) we silently
// return the original file so the upload still goes through.

export async function resizeImageFile(
  file: File,
  opts: { maxWidth?: number; maxHeight?: number; quality?: number; preferType?: "image/jpeg" | "image/webp" } = {}
): Promise<File> {
  try {
    return await tryResize(file, opts);
  } catch (e) {
    console.warn("[imageResize] resize failed, uploading original:", e);
    return file;
  }
}

async function tryResize(
  file: File,
  opts: { maxWidth?: number; maxHeight?: number; quality?: number; preferType?: "image/jpeg" | "image/webp" } = {}
): Promise<File> {
  const maxWidth = opts.maxWidth ?? 1600;
  const maxHeight = opts.maxHeight ?? 1600;
  const quality = opts.quality ?? 0.82;
  const preferType = opts.preferType ?? "image/jpeg";

  // Skip non-images and SVGs (vector — no resize needed)
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    return file;
  }

  // HEIC / HEIF — Safari can decode but most browsers can't. Skip resize and
  // upload the original; Supabase will store it and the user's browser may
  // still struggle to display it, but we won't lose the upload.
  if (/heic|heif/i.test(file.type)) {
    return file;
  }

  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });

  const img: HTMLImageElement = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Could not decode image."));
    i.src = dataUrl;
  });

  const { width, height } = img;
  // No resize needed
  if (width <= maxWidth && height <= maxHeight && file.size < 600 * 1024) {
    return file;
  }

  // Scale down proportionally
  const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
  const targetW = Math.round(width * ratio);
  const targetH = Math.round(height * ratio);

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const isPng = file.type === "image/png";
  const outType = isPng ? "image/png" : preferType;
  const outQuality = outType === "image/png" ? undefined : quality;

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), outType, outQuality)
  );
  if (!blob) return file;

  // If the resize somehow made it bigger, keep the original
  if (blob.size >= file.size) return file;

  const newName = renameExtension(file.name, outType);
  return new File([blob], newName, { type: outType, lastModified: Date.now() });
}

function renameExtension(name: string, mime: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  return `${base}.${ext}`;
}
