// src/app/shelves/_lib/spineCapture.ts
// Cuts the spine out of the live camera picture (or a photo), using the guide
// frame on screen, and turns it into what we store: an upright JPEG strip, its
// dominant colour and its width ÷ height.

export interface SpineShot {
  canvas: HTMLCanvasElement; // full-resolution crop for reading
  blob: Blob | null; // small upright JPEG for storage
  thumb: string; // data URL for the list
  color: string; // "#rrggbb"
  ratio: number; // spine width ÷ height
}

export interface GuideBox {
  x: number; // all as fractions (0..1) of the viewfinder box
  y: number;
  w: number;
  h: number;
}

/**
 * Maps the guide (drawn over a viewfinder showing the video with object-fit: cover)
 * to video pixels and copies that region.
 */
export function cropFromVideo(video: HTMLVideoElement, viewW: number, viewH: number, guide: GuideBox) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || !viewW || !viewH) return null;

  const scale = Math.max(viewW / vw, viewH / vh); // object-fit: cover
  const offsetX = (viewW - vw * scale) / 2;
  const offsetY = (viewH - vh * scale) / 2;

  const sx = Math.max(0, (guide.x * viewW - offsetX) / scale);
  const sy = Math.max(0, (guide.y * viewH - offsetY) / scale);
  const sw = Math.min(vw - sx, (guide.w * viewW) / scale);
  const sh = Math.min(vh - sy, (guide.h * viewH) / scale);
  if (sw < 4 || sh < 4) return null;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw);
  canvas.height = Math.round(sh);
  canvas.getContext("2d")!.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A photo of a single spine, downscaled to a sensible size. */
export async function canvasFromFile(file: File, maxSide = 1600) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

function dominantColor(source: HTMLCanvasElement) {
  const ctx = source.getContext("2d", { willReadFrequently: true })!;
  const x = Math.round(source.width * 0.2);
  const y = Math.round(source.height * 0.15);
  const w = Math.max(1, Math.round(source.width * 0.6));
  const h = Math.max(1, Math.round(source.height * 0.7));
  const { data } = ctx.getImageData(x, y, w, h);
  const step = Math.max(1, Math.floor(data.length / 4 / 1500)) * 4;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let i = 0; i < data.length; i += step) {
    rs.push(data[i]);
    gs.push(data[i + 1]);
    bs.push(data[i + 2]);
  }
  const median = (a: number[]) => a.sort((p, q) => p - q)[Math.floor(a.length / 2)] ?? 0;
  return `#${[median(rs), median(gs), median(bs)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export async function makeShot(crop: HTMLCanvasElement): Promise<SpineShot> {
  // Store spines standing up: a wide crop (phone held sideways) is turned upright
  const wide = crop.width > crop.height;
  const uprightW = wide ? crop.height : crop.width;
  const uprightH = wide ? crop.width : crop.height;
  const scale = Math.min(1, 520 / uprightH);

  const strip = document.createElement("canvas");
  strip.width = Math.max(2, Math.round(uprightW * scale));
  strip.height = Math.max(2, Math.round(uprightH * scale));
  const ctx = strip.getContext("2d")!;
  if (wide) {
    ctx.translate(strip.width / 2, strip.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(crop, (-strip.height) / 2, (-strip.width) / 2, strip.height, strip.width);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    ctx.drawImage(crop, 0, 0, strip.width, strip.height);
  }

  const blob = await new Promise<Blob | null>((resolve) => strip.toBlob(resolve, "image/jpeg", 0.82));
  return {
    canvas: crop,
    blob,
    thumb: strip.toDataURL("image/jpeg", 0.7),
    color: dominantColor(strip),
    ratio: Math.min(0.4, Math.max(0.012, uprightW / uprightH)),
  };
}
