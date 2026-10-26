// src/app/shelves/_components/DividerEditor.tsx
// The shelf photo with a line between every spine. Drag a line to move it,
// tap the photo to add one, tap × to remove one, tap a number to skip a gap
// that isn't a book (a bookend, a plant…). Scrolls sideways on small screens.

"use client";

import { PointerEvent as ReactPointerEvent, useRef, useState } from "react";
import { focusRing } from "../../components/ui/Button";

export default function DividerEditor({
  src,
  width,
  height,
  edges,
  skipped,
  onEdgesChange,
  onToggleSkip,
}: {
  src: string;
  width: number; // image pixels
  height: number;
  edges: number[];
  skipped: Set<number>;
  onEdgesChange: (edges: number[]) => void;
  onToggleSkip: (segment: number) => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const movedRef = useRef(false);

  const sorted = [...edges].sort((a, b) => a - b);
  const bounds = [0, ...sorted, width];

  function imageX(clientX: number) {
    const rect = frameRef.current!.getBoundingClientRect();
    return Math.round(((clientX - rect.left) / rect.width) * width);
  }

  function onFramePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (dragging !== null) return;
    if ((e.target as HTMLElement).closest("[data-divider-ui]")) return;
    const x = imageX(e.clientX);
    if (x <= 4 || x >= width - 4) return;
    if (sorted.some((d) => Math.abs(d - x) < width * 0.006)) return;
    onEdgesChange([...sorted, x].sort((a, b) => a - b));
  }

  function startDrag(i: number, e: ReactPointerEvent<HTMLButtonElement>) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    movedRef.current = false;
    setDragging(i);
  }

  function moveDrag(i: number, e: ReactPointerEvent<HTMLButtonElement>) {
    if (dragging !== i) return;
    movedRef.current = true;
    const min = (sorted[i - 1] ?? 0) + 3;
    const max = (sorted[i + 1] ?? width) - 3;
    const x = Math.min(max, Math.max(min, imageX(e.clientX)));
    const next = [...sorted];
    next[i] = x;
    onEdgesChange(next);
  }

  function nudge(i: number, delta: number) {
    const next = [...sorted];
    next[i] = Math.min((sorted[i + 1] ?? width) - 3, Math.max((sorted[i - 1] ?? 0) + 3, sorted[i] + delta));
    onEdgesChange(next);
  }

  return (
    <div className="overflow-x-auto overscroll-x-contain rounded-2xl bg-[#0f172a] p-2 [scrollbar-width:thin]">
      <div
        ref={frameRef}
        onPointerUp={onFramePointerUp}
        className="relative mx-auto [--h:280px] sm:[--h:380px] h-[var(--h)] cursor-crosshair select-none touch-pan-x"
        style={{ width: `calc(var(--h) * ${(width / height).toFixed(4)})` }}
      >
        <img src={src} alt="Your shelf photo" draggable={false} className="absolute inset-0 w-full h-full rounded-lg object-fill pointer-events-none" />

        {/* Skipped gaps are greyed out */}
        {bounds.slice(0, -1).map((x0, i) => {
          const x1 = bounds[i + 1];
          const skip = skipped.has(i);
          return (
            <div
              key={`seg-${i}`}
              className={`absolute top-0 bottom-0 pointer-events-none ${skip ? "bg-[#0f172a]/65" : ""}`}
              style={{ left: `${(x0 / width) * 100}%`, width: `${((x1 - x0) / width) * 100}%` }}
            >
              <button
                type="button"
                data-divider-ui
                onClick={() => onToggleSkip(i)}
                aria-pressed={!skip}
                aria-label={`Spine ${i + 1}: ${skip ? "skipped, tap to include" : "included, tap to skip"}`}
                className={`pointer-events-auto absolute bottom-1.5 left-1/2 -translate-x-1/2 min-w-6 h-6 px-1 rounded-full text-[10px] font-bold shadow ${focusRing} ${
                  skip ? "bg-white/30 text-white line-through" : "bg-[#fdfaf3] text-[#0f172a]"
                }`}
              >
                {i + 1}
              </button>
            </div>
          );
        })}

        {/* Dividers */}
        {sorted.map((x, i) => (
          <div key={`div-${i}`} data-divider-ui className="absolute top-0 bottom-0 -translate-x-1/2" style={{ left: `${(x / width) * 100}%` }}>
            <span aria-hidden="true" className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[2px] ${dragging === i ? "bg-[#e8c873]" : "bg-[#e8c873]/85"} shadow-[0_0_0_1px_rgba(15,23,42,0.5)]`} />
            <button
              type="button"
              onPointerDown={(e) => startDrag(i, e)}
              onPointerMove={(e) => moveDrag(i, e)}
              onPointerUp={() => setDragging(null)}
              onPointerCancel={() => setDragging(null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  nudge(i, e.shiftKey ? -10 : -2);
                } else if (e.key === "ArrowRight") {
                  e.preventDefault();
                  nudge(i, e.shiftKey ? 10 : 2);
                } else if (e.key === "Delete" || e.key === "Backspace") {
                  e.preventDefault();
                  onEdgesChange(sorted.filter((_, j) => j !== i));
                }
              }}
              aria-label={`Divider ${i + 1}. Drag or use arrow keys to move, Delete to remove.`}
              className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-11 rounded-full bg-[#e8c873] border-2 border-[#0f172a] cursor-ew-resize touch-none flex items-center justify-center ${focusRing}`}
            >
              <span aria-hidden="true" className="text-[#0f172a] text-[10px] leading-none">⇔</span>
            </button>
            <button
              type="button"
              onClick={() => onEdgesChange(sorted.filter((_, j) => j !== i))}
              aria-label={`Remove divider ${i + 1}`}
              className={`absolute top-1 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-[#0f172a]/85 text-white text-xs leading-none hover:bg-[#c0675b] ${focusRing}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
