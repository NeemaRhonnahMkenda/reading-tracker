// src/app/shelves/_lib/spineDetect.ts
// Finds the gaps between book spines in a photo of one shelf, entirely in the
// browser. Spine edges are vertical lines, so for every column we count how many
// rows have a sharp left-to-right change in brightness. Columns where that
// happens all the way down are almost certainly the edge between two books.

export interface ScanImage {
  canvas: HTMLCanvasElement; // the photo, downscaled to at most MAX_SIDE
  width: number;
  height: number;
}

export interface SpineCrop {
  index: number;
  x0: number;
  x1: number;
  color: string; // dominant spine colour "#rrggbb"
  ratio: number; // spine width ÷ book height (clamped for the database)
  thumb: string; // data URL for the preview list
  blob: Blob | null; // upload-ready JPEG strip (set by makeSpineCrops)
  canvas: HTMLCanvasElement; // full-height crop, used for OCR
}

const MAX_SIDE = 1800;
const ANALYSE_WIDTH = 1000;

// ------------------------------------------------------------
// Loading
// ------------------------------------------------------------

export async function loadScanImage(file: File): Promise<ScanImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return { canvas, width, height };
}

// ------------------------------------------------------------
// Detection
// ------------------------------------------------------------

/**
 * Returns the x positions (in image pixels) of the dividers between spines,
 * not including the left and right edges of the photo.
 * sensitivity 0..1: higher finds more (thinner) spines.
 */
export function detectSpineEdges(image: ScanImage, sensitivity = 0.5): number[] {
  const scale = Math.min(1, ANALYSE_WIDTH / image.width);
  const w = Math.max(40, Math.round(image.width * scale));
  const h = Math.max(40, Math.round(image.height * scale));

  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  const ctx = small.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image.canvas, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }

  // Middle band only: skips the shelf board above and below
  const top = Math.floor(h * 0.12);
  const bottom = Math.floor(h * 0.88);
  const rows = bottom - top;
  const threshold = 14 + (1 - sensitivity) * 14;

  const score = new Float32Array(w);
  for (let x = 2; x < w - 2; x++) {
    let hits = 0;
    for (let y = top; y < bottom; y++) {
      const row = y * w;
      const dx = Math.abs(gray[row + x + 1] - gray[row + x - 1]) + 0.5 * Math.abs(gray[row + x + 2] - gray[row + x - 2]);
      if (dx > threshold) hits++;
    }
    score[x] = hits / rows;
  }

  // Smooth across neighbouring columns
  const smooth = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    let n = 0;
    for (let k = -2; k <= 2; k++) {
      const xi = x + k;
      if (xi >= 0 && xi < w) {
        sum += score[xi] * (3 - Math.abs(k));
        n += 3 - Math.abs(k);
      }
    }
    smooth[x] = sum / n;
  }

  let mean = 0;
  for (const v of smooth) mean += v;
  mean /= w;
  let variance = 0;
  for (const v of smooth) variance += (v - mean) ** 2;
  const std = Math.sqrt(variance / w);

  const k = 1.4 - sensitivity * 1.2; // 1.4 (few) .. 0.2 (many)
  const minGap = Math.max(5, Math.round(w * (0.022 - sensitivity * 0.014)));

  const candidates: { x: number; s: number }[] = [];
  for (let x = minGap; x < w - minGap; x++) {
    const v = smooth[x];
    if (v > mean + k * std && v >= smooth[x - 1] && v >= smooth[x + 1]) candidates.push({ x, s: v });
  }

  candidates.sort((a, b) => b.s - a.s);
  const accepted: number[] = [];
  for (const c of candidates) {
    if (accepted.every((a) => Math.abs(a - c.x) >= minGap)) accepted.push(c.x);
    if (accepted.length >= 120) break;
  }

  return accepted.sort((a, b) => a - b).map((x) => Math.round(x / scale));
}

// ------------------------------------------------------------
// Cropping
// ------------------------------------------------------------

function dominantColor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const { data } = ctx.getImageData(x, y, Math.max(1, w), Math.max(1, h));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const step = Math.max(4, Math.floor(data.length / 4 / 1500)) * 4;
  for (let i = 0; i < data.length; i += step) {
    rs.push(data[i]);
    gs.push(data[i + 1]);
    bs.push(data[i + 2]);
  }
  const median = (arr: number[]) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)] ?? 0;
  return `#${[median(rs), median(gs), median(bs)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function toBlob(canvas: HTMLCanvasElement, quality = 0.82) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** Cuts the photo into one strip per spine. `edges` are the dividers between spines. */
export async function makeSpineCrops(image: ScanImage, edges: number[], skip: Set<number> = new Set()): Promise<SpineCrop[]> {
  const bounds = [0, ...edges.filter((x) => x > 0 && x < image.width).sort((a, b) => a - b), image.width];
  const source = image.canvas.getContext("2d", { willReadFrequently: true })!;
  const crops: SpineCrop[] = [];

  for (let i = 0; i < bounds.length - 1; i++) {
    if (skip.has(i)) continue;
    const x0 = Math.round(bounds[i]);
    const x1 = Math.round(bounds[i + 1]);
    const w = x1 - x0;
    if (w < 4) continue;

    // Trim 2% top and bottom (shelf edges); inset 6% from the sides for the colour
    const y0 = Math.round(image.height * 0.02);
    const h = Math.round(image.height * 0.96);

    const crop = document.createElement("canvas");
    crop.width = w;
    crop.height = h;
    crop.getContext("2d")!.drawImage(image.canvas, x0, y0, w, h, 0, 0, w, h);

    // Small strip for storage: max 520 px tall
    const s = Math.min(1, 520 / h);
    const strip = document.createElement("canvas");
    strip.width = Math.max(2, Math.round(w * s));
    strip.height = Math.max(2, Math.round(h * s));
    strip.getContext("2d")!.drawImage(crop, 0, 0, strip.width, strip.height);

    const inset = Math.round(w * 0.12);
    crops.push({
      index: i,
      x0,
      x1,
      color: dominantColor(source, x0 + inset, Math.round(image.height * 0.15), w - inset * 2, Math.round(image.height * 0.7)),
      ratio: Math.min(0.4, Math.max(0.012, w / (image.height * 0.9))),
      thumb: strip.toDataURL("image/jpeg", 0.7),
      blob: await toBlob(strip),
      canvas: crop,
    });
  }

  return crops;
}
