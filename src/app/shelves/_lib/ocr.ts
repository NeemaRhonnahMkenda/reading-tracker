// src/app/shelves/_lib/ocr.ts
// Reads the text on one spine with Tesseract, in the browser.
// One worker is started per scanning session and reused for every read, so
// after the first read (which loads the engine) each read takes well under a second.
// Spine text runs along the book, so the strip is turned a quarter turn both
// ways (and left as-is for a phone held sideways); the clearest read wins.

export interface SpineRead {
  text: string;
  confidence: number;
}

export interface SpineReader {
  read: (spine: HTMLCanvasElement) => Promise<SpineRead>;
  terminate: () => Promise<void>;
}

// Rotate (0, 90 or -90 degrees), scale so the text is ~64 px tall, greyscale + stretch contrast
function prepare(source: HTMLCanvasElement, turn: 0 | 1 | -1) {
  const across = turn === 0 ? source.height : source.width; // the side the letters stand on
  const scale = Math.min(3, Math.max(0.6, 64 / Math.max(1, across)));
  const sw = source.width * scale;
  const sh = source.height * scale;
  const w = Math.round(turn === 0 ? sw : sh);
  const h = Math.round(turn === 0 ? sh : sw);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.translate(w / 2, h / 2);
  ctx.rotate((turn * Math.PI) / 2);
  ctx.drawImage(source, -sw / 2, -sh / 2, sw, sh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
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

export async function createSpineReader(): Promise<SpineReader> {
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng");
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });

  return {
    async read(spine) {
      // Tall strip: text runs top-to-bottom (most English spines) or bottom-to-top.
      // Wide strip: the phone was held sideways, so the text is already level.
      const turns: (0 | 1 | -1)[] = spine.height >= spine.width ? [-1, 1] : [0];
      let best: SpineRead = { text: "", confidence: 0 };
      for (const turn of turns) {
        const { data } = await worker.recognize(prepare(spine, turn));
        const text = clean(data.text);
        const confidence = text ? data.confidence : 0;
        if (confidence > best.confidence) best = { text, confidence };
        if (best.confidence >= 65) break; // clear enough, skip the other way
      }
      return best;
    },
    terminate: () => worker.terminate().then(() => undefined),
  };
}
