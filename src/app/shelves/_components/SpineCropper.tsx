// src/app/shelves/_components/SpineCropper.tsx
// Place the crop exactly on the spine: drag any edge or corner, or drag inside
// the box to move it. Arrow keys nudge the box (Shift = bigger steps).
// A live preview shows the strip that will be used on the shelf.

"use client";

import { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import Button, { focusRing } from "../../components/ui/Button";
import type { CropRect } from "../_lib/spineCapture";

type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const MIN_W = 0.03;
const MIN_H = 0.15;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function applyDrag(start: CropRect, handle: Handle, dx: number, dy: number): CropRect {
  let { x, y, w, h } = start;
  if (handle === "move") {
    return { x: clamp(x + dx, 0, 1 - w), y: clamp(y + dy, 0, 1 - h), w, h };
  }
  if (handle.includes("w")) {
    const nx = clamp(x + dx, 0, x + w - MIN_W);
    w += x - nx;
    x = nx;
  }
  if (handle.includes("e")) w = clamp(w + dx, MIN_W, 1 - x);
  if (handle.includes("n")) {
    const ny = clamp(y + dy, 0, y + h - MIN_H);
    h += y - ny;
    y = ny;
  }
  if (handle.includes("s")) h = clamp(h + dy, MIN_H, 1 - y);
  return { x, y, w, h };
}

const HANDLES: { id: Handle; className: string; label: string }[] = [
  { id: "n", className: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 w-10 h-5 cursor-ns-resize", label: "top edge" },
  { id: "s", className: "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 w-10 h-5 cursor-ns-resize", label: "bottom edge" },
  { id: "w", className: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-10 cursor-ew-resize", label: "left edge" },
  { id: "e", className: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 w-5 h-10 cursor-ew-resize", label: "right edge" },
  { id: "nw", className: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 w-5 h-5 cursor-nwse-resize", label: "top-left corner" },
  { id: "ne", className: "right-0 top-0 translate-x-1/2 -translate-y-1/2 w-5 h-5 cursor-nesw-resize", label: "top-right corner" },
  { id: "sw", className: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 w-5 h-5 cursor-nesw-resize", label: "bottom-left corner" },
  { id: "se", className: "right-0 bottom-0 translate-x-1/2 translate-y-1/2 w-5 h-5 cursor-nwse-resize", label: "bottom-right corner" },
];

export default function SpineCropper({
  picture,
  initial,
  title,
  onUse,
  onRetake,
  onCancel,
}: {
  picture: HTMLCanvasElement;
  initial: CropRect;
  title?: string;
  onUse: (rect: CropRect) => void;
  onRetake?: () => void;
  onCancel: () => void;
}) {
  const [rect, setRect] = useState<CropRect>(initial);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ handle: Handle; startX: number; startY: number; start: CropRect } | null>(null);

  const src = useMemo(() => picture.toDataURL("image/jpeg", 0.9), [picture]);
  const aspect = picture.width / picture.height;

  useEffect(() => setRect(initial), [initial, picture]);

  function onDown(handle: Handle, e: ReactPointerEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { handle, startX: e.clientX, startY: e.clientY, start: rect };
  }

  function onMove(e: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    const frame = frameRef.current?.getBoundingClientRect();
    if (!drag || !frame) return;
    const dx = (e.clientX - drag.startX) / frame.width;
    const dy = (e.clientY - drag.startY) / frame.height;
    setRect(applyDrag(drag.start, drag.handle, dx, dy));
  }

  function onUp() {
    dragRef.current = null;
  }

  function onKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 0.03 : 0.006;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    setRect((r) => applyDrag(r, e.altKey ? (e.key === "ArrowLeft" || e.key === "ArrowRight" ? "e" : "s") : "move", m[0], m[1]));
  }

  // The strip that will be kept, drawn by positioning the picture behind a small window
  const previewH = 168;
  const previewW = Math.max(10, Math.min(90, previewH * ((rect.w * picture.width) / (rect.h * picture.height))));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-classical text-lg font-semibold text-[#0f172a]">Place the crop on the spine</h3>
          <p className="text-sm text-slate-500 leading-6">
            Drag the edges to match the spine{title ? ` of ${title}` : ""}, or drag inside the box to move it.
          </p>
        </div>
      </div>

      <div className="flex gap-4 items-start">
        {/* Picture + crop box */}
        <div className="flex-1 min-w-0 rounded-2xl bg-[#0f172a] p-3 flex justify-center overflow-hidden">
          <div
            ref={frameRef}
            className="relative select-none touch-none max-w-full"
            style={{ height: "min(46vh, 420px)", aspectRatio: String(aspect) }}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <img src={src} alt="The spine photo you took" draggable={false} className="absolute inset-0 w-full h-full rounded-md object-fill pointer-events-none" />

            <div
              role="group"
              tabIndex={0}
              aria-label="Crop box. Arrow keys move it; hold Alt to resize."
              onKeyDown={onKey}
              onPointerDown={(e) => onDown("move", e)}
              className={`absolute border-2 border-[#e8c873] shadow-[0_0_0_9999px_rgba(15,23,42,0.6)] cursor-move rounded-sm ${focusRing}`}
              style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
            >
              {/* Thirds, to help line up straight */}
              <span aria-hidden="true" className="absolute inset-x-0 top-1/3 h-px bg-white/25" />
              <span aria-hidden="true" className="absolute inset-x-0 top-2/3 h-px bg-white/25" />
              {HANDLES.map((h) => (
                <span
                  key={h.id}
                  aria-hidden="true"
                  title={`Drag the ${h.label}`}
                  onPointerDown={(e) => onDown(h.id, e)}
                  className={`absolute rounded-full bg-[#e8c873] border-2 border-[#0f172a] touch-none ${h.className}`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* What it will look like */}
        <div className="shrink-0 hidden min-[420px]:flex flex-col items-center gap-2">
          <div
            className="relative overflow-hidden rounded-[3px] shadow-[0_6px_14px_rgba(15,23,42,0.3)] ring-1 ring-black/20 bg-[#e9e4d9]"
            style={{ width: previewW, height: previewH }}
            aria-hidden="true"
          >
            <img
              src={src}
              alt=""
              draggable={false}
              className="absolute max-w-none"
              style={{
                width: `${100 / rect.w}%`,
                height: `${100 / rect.h}%`,
                left: `${(-rect.x / rect.w) * 100}%`,
                top: `${(-rect.y / rect.h) * 100}%`,
              }}
            />
          </div>
          <span className="text-[11px] text-slate-500">On the shelf</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setRect(initial)}>
            Reset
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRect({ x: 0, y: 0, w: 1, h: 1 })}>
            Whole picture
          </Button>
        </span>
        <span className="flex flex-wrap justify-end gap-2 ml-auto">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        {onRetake && (
          <Button variant="outline" size="sm" onClick={onRetake}>
            Retake
          </Button>
        )}
        <Button size="sm" onClick={() => onUse(rect)}>
          Use this photo
        </Button>
        </span>
      </div>
    </div>
  );
}
