// src/app/library/[bookId]/_lib/storyCard.ts
// Draws a 1080 × 1920 story card in the style of the book posts:
//   handwritten "Book Twelve", the year, the cover, a genre label with a
//   hand-drawn arrow on each side, the star rating (quarter stars), and the
//   text underneath (what it's about, or the review).
// Everything is drawn on a <canvas>, so the preview is exactly the image you save.

export const CARD_W = 1080;
export const CARD_H = 1920;

export type CardKind = "about" | "review";

export interface CardData {
  kind: CardKind;
  bookNumber: number | null;
  year: number | null;
  tagLeft: string;
  tagRight: string;
  text: string;
  rating: number | null; // drawn on review cards when set
  cover: HTMLImageElement | HTMLCanvasElement | null;
  title: string;
  author: string | null;
}

export interface CardLayout {
  fits: boolean; // false when the text had to be cut off
  fontSize: number;
}

// ------------------------------------------------------------
// Fonts (Google Fonts, loaded once before drawing)
// ------------------------------------------------------------

const FONT_HEADING = '"Homemade Apple", "Brush Script MT", cursive';
const FONT_TAG = '"Homemade Apple", "Brush Script MT", cursive';
const FONT_YEAR = '"Playfair Display", Georgia, serif';
const FONT_BODY = '"Patrick Hand", "Comic Sans MS", cursive';

const FONT_CSS = "https://fonts.googleapis.com/css2?family=Homemade+Apple&family=Patrick+Hand&family=Playfair+Display:wght@400&display=swap";

let fontsReady: Promise<void> | null = null;

export function loadCardFonts(): Promise<void> {
  if (fontsReady) return fontsReady;
  fontsReady = (async () => {
    if (!document.querySelector(`link[data-story-fonts]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = FONT_CSS;
      link.dataset.storyFonts = "1";
      document.head.appendChild(link);
      await new Promise((resolve) => {
        link.onload = resolve;
        link.onerror = resolve;
      });
    }
    const loads = [
      document.fonts.load('80px "Homemade Apple"', "Book Twelve"),
      document.fonts.load('80px "Playfair Display"', "2026"),
      document.fonts.load('36px "Patrick Hand"', "The quick brown fox"),
    ];
    // Never hold the card forever: fall back to system fonts after a few seconds
    await Promise.race([Promise.allSettled(loads), new Promise((r) => setTimeout(r, 6000))]);
  })();
  return fontsReady;
}

// ------------------------------------------------------------
// Numbers as words: 12 -> "Twelve", 47 -> "Forty-Seven"
// ------------------------------------------------------------

const ONES = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

export function numberWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999) return String(n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
  const rest = n % 100;
  return `${ONES[Math.floor(n / 100)]} Hundred${rest ? ` and ${numberWords(rest)}` : ""}`;
}

// ------------------------------------------------------------
// Paper: warm off-white with grain and faint fibres (made once)
// ------------------------------------------------------------

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

let paper: HTMLCanvasElement | null = null;

function paperTexture(): HTMLCanvasElement {
  if (paper) return paper;
  const c = document.createElement("canvas");
  c.width = CARD_W;
  c.height = CARD_H;
  const ctx = c.getContext("2d")!;
  const rand = seeded(20260412);

  ctx.fillStyle = "#f1efea";
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Grain
  const img = ctx.getImageData(0, 0, CARD_W, CARD_H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 10;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n - 1;
  }
  ctx.putImageData(img, 0, 0);

  // Fibres
  ctx.lineCap = "round";
  for (let i = 0; i < 170; i++) {
    const x = rand() * CARD_W;
    const y = rand() * CARD_H;
    const len = 40 + rand() * 160;
    const a = rand() * Math.PI * 2;
    ctx.strokeStyle = `rgba(120, 112, 96, ${0.04 + rand() * 0.06})`;
    ctx.lineWidth = 0.6 + rand() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a + 0.6) * len * 0.5, y + Math.sin(a + 0.6) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }

  // Soft edges
  const g = ctx.createRadialGradient(CARD_W / 2, CARD_H / 2, CARD_H * 0.35, CARD_W / 2, CARD_H / 2, CARD_H * 0.75);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(80,70,50,0.07)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  paper = c;
  return c;
}

// ------------------------------------------------------------
// Pieces
// ------------------------------------------------------------

const INK = "#141414";

// Script fonts report their ink width unreliably, so draw the word off-screen
// once and find where its pixels actually start and end
const inkCache = new Map<string, { left: number; right: number }>();

function inkExtent(word: string, size: number): { left: number; right: number } {
  const key = `${size}|${word}`;
  const hit = inkCache.get(key);
  if (hit) return hit;
  const pad = size * 2;
  const c = document.createElement("canvas");
  const probe = c.getContext("2d")!;
  probe.font = `${size}px ${FONT_HEADING}`;
  c.width = Math.ceil(probe.measureText(word).width + pad * 2);
  c.height = Math.ceil(size * 3);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.font = `${size}px ${FONT_HEADING}`;
  ctx.lineWidth = 2.2;
  ctx.textBaseline = "alphabetic";
  ctx.strokeText(word, pad, size * 2);
  ctx.fillText(word, pad, size * 2);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let min = width;
  let max = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 40) {
        if (x < min) min = x;
        if (x > max) max = x;
      }
    }
  }
  const out = max < 0 ? { left: 0, right: probe.measureText(word).width } : { left: pad - min, right: max - pad };
  inkCache.set(key, out);
  return out;
}

/**
 * The "Book Twelve" heading. The script font's own space is very narrow, and
 * capitals like the T swing back to the left, so the words are drawn one by one
 * and spaced by where their ink actually starts and ends.
 */
function drawHeading(ctx: CanvasRenderingContext2D, words: string[], baseline: number) {
  const maxWidth = 900;
  const wordGap = 0.42; // clear space between words, in ems
  let size = 78;
  let inks: { left: number; right: number }[] = [];
  let total = 0;
  for (; size >= 44; size -= 2) {
    ctx.font = `${size}px ${FONT_HEADING}`;
    inks = words.map((w) => inkExtent(w, size));
    total = inks.reduce((sum, k) => sum + k.left + k.right, 0) + size * wordGap * (words.length - 1);
    if (total <= maxWidth) break;
  }
  ctx.save();
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.2; // a touch heavier, like a felt-tip pen
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let inkX = (CARD_W - total) / 2; // where the next word's ink starts
  words.forEach((word, i) => {
    const x = inkX + inks[i].left;
    ctx.strokeText(word, x, baseline);
    ctx.fillText(word, x, baseline);
    inkX = x + inks[i].right + size * wordGap;
  });
  ctx.restore();
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// The cover always sits in a book-shaped frame (2:3), whatever shape the image is
const COVER_TOP = 302;
const COVER_H = 893;
const COVER_W = Math.round((COVER_H * 2) / 3); // 595

/** Draws the cover and returns where it landed, so labels and stars can sit around it. */
function drawCover(ctx: CanvasRenderingContext2D, data: CardData): Rect {
  const w = COVER_W;
  const h = COVER_H;
  const x = Math.round((CARD_W - w) / 2);
  const y = COVER_TOP;
  const img = data.cover;

  // Soft shadow under a square-cornered book
  ctx.save();
  ctx.shadowColor = "rgba(30, 25, 15, 0.2)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  if (img) {
    // Fill the frame, trimming the edges of images that aren't book-shaped
    const iw = "naturalWidth" in img ? img.naturalWidth : img.width;
    const ih = "naturalHeight" in img ? img.naturalHeight : img.height;
    const scale = Math.max(w / iw, h / ih);
    const sw = w / scale;
    const sh = h / scale;
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
  } else {
    // No cover: The Archive's placeholder, with the title
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#fdfaf3";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const lines = wrapLines(ctx, data.title, `600 56px ${FONT_YEAR}`, w - 90);
    lines.slice(0, 5).forEach((line, i) => ctx.fillText(line, CARD_W / 2, y + h * 0.42 + i * 68));
    if (data.author) {
      ctx.globalAlpha = 0.7;
      ctx.font = `32px ${FONT_YEAR}`;
      ctx.fillText(data.author, CARD_W / 2, y + h * 0.42 + Math.min(lines.length, 5) * 68 + 40);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
  return { x, y, w, h };
}

// Space for the labels: card edge margin and gap to the cover
const EDGE = 22;
const GAP = 18;

interface TagLayout {
  size: number;
  lines: string[];
  lh: number;
  rotW: number; // width and height once slanted
  rotH: number;
}

function lineWidth(ctx: CanvasRenderingContext2D, line: string) {
  // The real ink extent: script letters lean past their advance width
  const m = ctx.measureText(line);
  return Math.max(m.width, (m.actualBoundingBoxLeft ?? 0) + (m.actualBoundingBoxRight ?? 0));
}

/**
 * The biggest size (and fewest lines, up to three) at which the slanted label
 * fits inside `room` pixels across. Words are only split if a single word
 * can't fit even at the smallest size.
 */
function layoutTag(ctx: CanvasRenderingContext2D, text: string, room: number, angle: number): TagLayout {
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const measure = (size: number, lines: string[]): TagLayout => {
    ctx.font = `${size}px ${FONT_TAG}`;
    const lh = size * 1.25;
    const blockW = Math.max(...lines.map((l) => lineWidth(ctx, l))) + 6;
    const blockH = lines.length * lh;
    return { size, lines, lh, rotW: blockW * cos + blockH * sin, rotH: blockW * sin + blockH * cos };
  };

  const words = text.split(/\s+/).filter(Boolean);
  let last: TagLayout | null = null;
  for (let size = 40; size >= 18; size -= 2) {
    ctx.font = `${size}px ${FONT_TAG}`;
    const total = lineWidth(ctx, words.join(" "));
    const widestWord = Math.max(...words.map((w) => lineWidth(ctx, w)));
    for (let count = 1; count <= 3; count++) {
      // Balanced lines: aim for an even split, never narrower than the longest word
      const target = Math.max(widestWord, (total / count) * 1.08);
      const lines = wrapLines(ctx, words.join(" "), `${size}px ${FONT_TAG}`, target);
      if (lines.length > 3) continue;
      const layout = measure(size, lines);
      last = layout;
      if (layout.rotW <= room) return layout;
    }
  }
  // A single word too long for the space even at the smallest size: break it
  ctx.font = `18px ${FONT_TAG}`;
  const inner = (room - 6) / (cos + 0.2);
  const broken = wrapLines(ctx, words.join(" "), `18px ${FONT_TAG}`, inner).slice(0, 3);
  return broken.length ? measure(18, broken) : (last ?? measure(18, [text]));
}

/** Draws a slanted label centred on (cx, cy); returns its slanted size. */
function drawTag(ctx: CanvasRenderingContext2D, layout: TagLayout, cx: number, cy: number, angle: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${layout.size}px ${FONT_TAG}`;
  layout.lines.forEach((line, i) => ctx.fillText(line, 0, (i - (layout.lines.length - 1) / 2) * layout.lh));
  ctx.restore();
}

/** A label in the space beside the cover, with an arrow curving in to the cover's edge. */
function drawLabel(ctx: CanvasRenderingContext2D, text: string, side: "left" | "right", cover: Rect, cy: number) {
  const clean = text.trim();
  if (!clean) return;
  const angle = side === "left" ? -0.2 : 0.2;
  const left = side === "left" ? EDGE : cover.x + cover.w + GAP;
  const right = side === "left" ? cover.x - GAP : CARD_W - EDGE;
  const room = Math.max(60, right - left);

  const layout = layoutTag(ctx, clean, room, angle);
  const cx = (left + right) / 2;
  drawTag(ctx, layout, cx, cy, angle);

  // Arrow: from under the label to just short of the cover
  const sy = cy + layout.rotH / 2 + 12;
  const ey = sy + 72;
  if (side === "left") {
    const ex = cover.x - 12;
    const sx = Math.min(cx, ex - 50);
    drawArrow(ctx, [
      [sx, sy],
      [sx - 14, sy + 44],
      [sx + (ex - sx) * 0.3, ey + 4],
      [ex, ey],
    ]);
  } else {
    const ex = cover.x + cover.w + 12;
    const sx = Math.max(cx - 20, ex + 50);
    drawArrow(ctx, [
      [sx, sy],
      [sx + 16, sy + 44],
      [sx - (sx - ex) * 0.3, ey + 6],
      [ex, ey],
    ]);
  }
}

/** A loose hand-drawn arrow along a curve, with an open head. */
function drawArrow(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  const [p0, p1, p2, p3] = pts;
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  ctx.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
  ctx.stroke();

  const angle = Math.atan2(p3[1] - p2[1], p3[0] - p2[0]);
  const len = 24;
  ctx.beginPath();
  ctx.moveTo(p3[0] - Math.cos(angle - 0.55) * len, p3[1] - Math.sin(angle - 0.55) * len);
  ctx.lineTo(p3[0], p3[1]);
  ctx.lineTo(p3[0] - Math.cos(angle + 0.55) * len, p3[1] - Math.sin(angle + 0.55) * len);
  ctx.stroke();
  ctx.restore();
}

// Made on first use: Path2D only exists in the browser, and this file is also loaded on the server
// Sharp five-pointed star in a 24 x 24 box: inner points at 0.38 of the outer
// radius (a classic pentagram star) give long, pointy tips
let star: Path2D | null = null;
const STAR_R = 12;
const STAR_CY = 12.9; // centred so the top tip touches the top of the box
const STAR = () => {
  if (star) return star;
  const path = new Path2D();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? STAR_R : STAR_R * 0.38;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = 12 + r * Math.cos(a);
    const py = STAR_CY + r * Math.sin(a);
    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  }
  path.closePath();
  return (star = path);
};

const STAR_SIZE = 70;
const STAR_GAP_BELOW_COVER = 6; // cover bottom to the stars' top tips

/** Draws the rating under the cover; returns the y of the stars' lowest points. */
function drawStars(ctx: CanvasRenderingContext2D, rating: number, coverBottom: number) {
  const size = STAR_SIZE;
  const gap = 8;
  const cy = coverBottom + STAR_GAP_BELOW_COVER + size / 2;
  const total = size * 5 + gap * 4;
  const x0 = (CARD_W - total) / 2;
  const scale = size / 24;

  for (let i = 0; i < 5; i++) {
    const fill = Math.max(0, Math.min(1, rating - i));
    ctx.save();
    ctx.translate(x0 + i * (size + gap), cy - size / 2);
    ctx.scale(scale, scale);
    ctx.fillStyle = "#d6d6d6";
    ctx.fill(STAR());
    if (fill > 0) {
      ctx.beginPath();
      ctx.rect(0, 0, 24 * fill, 24);
      ctx.clip();
      ctx.fillStyle = "#f6b511";
      ctx.fill(STAR());
    }
    ctx.restore();
  }
  // Lowest point of a star: centre plus the outer radius' lower tips (sin 54°)
  return cy - size / 2 + (STAR_CY + STAR_R * Math.sin((54 * Math.PI) / 180)) * (size / 24);
}

// ------------------------------------------------------------
// Text
// ------------------------------------------------------------

function wrapLines(ctx: CanvasRenderingContext2D, text: string, font: string, maxWidth: number): string[] {
  ctx.font = font;
  const out: string[] = [];
  for (const para of text.replace(/\r/g, "").split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth || !line) {
        // A single word wider than the line gets broken up
        if (!line && ctx.measureText(word).width > maxWidth) {
          let chunk = "";
          for (const ch of word) {
            if (ctx.measureText(chunk + ch).width > maxWidth) {
              out.push(chunk);
              chunk = ch;
            } else chunk += ch;
          }
          line = chunk;
        } else line = next;
      } else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

// An empty line (between paragraphs) takes half a line, like a paragraph gap
function textHeight(lines: string[], lh: number) {
  return lines.reduce((h, l) => h + (l ? lh : lh * 0.5), 0);
}

function bodyArea(data: CardData, aboveBottom: number) {
  const showStars = data.kind === "review" && !!data.rating;
  return {
    top: aboveBottom + (showStars ? 14 : 22),
    bottom: CARD_H - 34,
    width: data.kind === "about" ? 1000 : 960,
  };
}

/** Picks the largest text size that fits, the way the sample posts shrink long text. */
export function layoutBody(ctx: CanvasRenderingContext2D, data: CardData, aboveBottom = COVER_TOP + COVER_H) {
  const area = bodyArea(data, aboveBottom);
  const text = data.text.trim();
  for (let size = 40; size >= 25; size -= 1) {
    const lines = wrapLines(ctx, text, `${size}px ${FONT_BODY}`, area.width);
    const lh = Math.round(size * 1.42);
    if (textHeight(lines, lh) <= area.bottom - area.top) return { size, lh, lines, fits: true, area };
  }
  const size = 25;
  const lh = Math.round(size * 1.42);
  const all = wrapLines(ctx, text, `${size}px ${FONT_BODY}`, area.width);
  const lines: string[] = [];
  for (const line of all) {
    if (textHeight([...lines, line], lh) > area.bottom - area.top) break;
    lines.push(line);
  }
  if (all.length > lines.length && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1].replace(/\s*\S*$/, "")}…`;
  return { size, lh, lines, fits: all.length <= lines.length, area };
}

// ------------------------------------------------------------
// The card
// ------------------------------------------------------------

export function drawStoryCard(canvas: HTMLCanvasElement, data: CardData): CardLayout {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(paperTexture(), 0, 0);

  // "Book Twelve"
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  drawHeading(ctx, data.bookNumber ? ["Book", numberWords(data.bookNumber)] : ["Currently", "reading"], 178);

  // "2026"
  if (data.year) {
    ctx.font = `86px ${FONT_YEAR}`;
    ctx.fillText(String(data.year), CARD_W / 2, 286);
  }

  const cover = drawCover(ctx, data);

  // Genre labels in the space beside the cover, with arrows pointing at it
  drawLabel(ctx, data.tagLeft, "left", cover, 545);
  drawLabel(ctx, data.tagRight, "right", cover, 812);

  const coverBottom = cover.y + cover.h;
  const aboveBody = data.kind === "review" && data.rating ? drawStars(ctx, data.rating, coverBottom) : coverBottom;

  // The words underneath
  const body = layoutBody(ctx, data, aboveBody);
  ctx.fillStyle = "#1c1c1c";
  ctx.font = `${body.size}px ${FONT_BODY}`;
  ctx.textAlign = "center";
  let y = body.area.top + body.size;
  for (const line of body.lines) {
    if (line) {
      ctx.fillText(line, CARD_W / 2, y);
      y += body.lh;
    } else y += body.lh * 0.5;
  }

  return { fits: body.fits, fontSize: body.size };
}

export function cardBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the image"))), "image/png"));
}

// ------------------------------------------------------------
// Cover image: straight from its source when it allows it, otherwise
// through this app's own cover proxy (needed so the card can be saved)
// ------------------------------------------------------------

function loadImage(src: string, cors: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed"));
    img.src = src;
  });
}

export async function loadCover(sources: string[]): Promise<HTMLImageElement | null> {
  for (const src of sources) {
    if (!src) continue;
    try {
      if (src.startsWith("blob:") || src.startsWith("data:")) return await loadImage(src, false);
      return await loadImage(src, true);
    } catch {
      try {
        return await loadImage(`/api/story/cover?url=${encodeURIComponent(src)}`, false);
      } catch {
        // try the next source
      }
    }
  }
  return null;
}

export function cardFileName(title: string, kind: CardKind, bookNumber: number | null) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return `${bookNumber ? `book-${bookNumber}-` : ""}${slug || "book"}-${kind === "about" ? "about" : "review"}.png`;
}