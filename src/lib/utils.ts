import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Image -> data URL small enough to store inline (attachments live in the DB for now).
 * Big screenshots are scaled to 1600px wide JPEG. Returns undefined for non-images or if still too big.
 */
export async function imageToDataUrl(f: File, maxBytes = 700_000): Promise<string | undefined> {
  if (!f.type.startsWith("image/")) return undefined;
  const raw = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(f);
  });
  if (raw.length <= maxBytes && /^image\/(png|jpeg|gif|webp)$/.test(f.type)) return raw; // others (svg, bmp…) get re-encoded
  const img = new Image();
  img.src = raw;
  await img.decode();
  const scale = Math.min(1, 1600 / img.width);
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; // JPEG has no alpha
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const out = c.toDataURL("image/jpeg", 0.8);
  return out.length <= maxBytes ? out : undefined;
}

/** Browsers block opening data: URLs in a new tab, so open them as a blob URL instead. */
export async function openDataUrl(url: string) {
  const blob = await (await fetch(url)).blob();
  window.open(URL.createObjectURL(blob), "_blank", "noopener");
}
