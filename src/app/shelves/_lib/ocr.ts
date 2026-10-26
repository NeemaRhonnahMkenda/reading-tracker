// src/app/shelves/_lib/ocr.ts
// Reads the text on each spine with Tesseract, in the browser.
// Loaded on demand, so it adds nothing to the page until you scan.
// English spines read top to bottom, so each strip is turned a quarter turn
// anticlockwise first; if that reads badly, the other way round is tried.

import type { SpineCrop } from "./spineDetect";

export interface SpineText {
  index: number;
  text: string;
  confidence: number;
}

function rotated(source: HTMLCanvasElement, direction: 1 | -1) {
  // Text height on a spine ≈ strip width; aim for ~64 px tall text
  const scale = Math.min(3, Math.max(1, 64 / Math.max(1, source.width)));
  const w = Math.round(source.height * scale);
  const h = Math.round(source.width * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(w / 2, h / 2);
  ctx.rotate((direction * Math.PI) / 2);
  ctx.drawImage(source, (-source.width * scale) / 2, (-source.height * scale) / 2, source.width * scale, source.height * scale);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Greyscale + stretch contrast: helps on glossy and dark spines
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = ((d[i] - min) / range) * 255;
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function clean(text: string) {
  return text
    .replace(/[^\p{L}\p{N}'&:\-\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 || /^[a-z0-9]$/i.test(w))
    .join(" ")
    .trim();
}

export async function readSpines(
  crops: SpineCrop[],
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<SpineText[]> {
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng");
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });

  const results: SpineText[] = [];
  try {
    for (let i = 0; i < crops.length; i++) {
      if (signal?.aborted) break;
      const crop = crops[i];

      let best = { text: "", confidence: 0 };
      for (const dir of [-1, 1] as const) {
        const { data } = await worker.recognize(rotated(crop.canvas, dir));
        const text = clean(data.text);
        const confidence = text ? data.confidence : 0;
        if (confidence > best.confidence) best = { text, confidence };
        if (best.confidence >= 60) break; // good enough, skip the other direction
      }

      results.push({ index: crop.index, ...best });
      onProgress(i + 1, crops.length);
    }
  } finally {
    await worker.terminate();
  }
  return results;
}
