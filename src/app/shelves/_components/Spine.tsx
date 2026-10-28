// src/app/shelves/_components/Spine.tsx
// One book on a shelf: standing up (a spine) or lying flat (in a pile).
// Shows your scanned spine photo when there is one, otherwise a painted
// cloth-bound spine in a colour that's always the same for that book.

"use client";

import { CSSProperties, memo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { focusRing } from "../../components/ui/Button";
import { heightRatio, paintedColor, readableText, showsPhoto, spineRatio, type Placement, type ShelfBook } from "../_lib/shelves";

export interface SpineLook {
  book: ShelfBook;
  placement: Placement | undefined;
  photo: string | null; // signed spine photo URL
  usePhoto: boolean;
  shelfHeight: number; // inner height of the shelf in px
}

export function spineSize({ book, placement, shelfHeight }: Pick<SpineLook, "book" | "placement" | "shelfHeight">) {
  const height = Math.round(shelfHeight * heightRatio(book.id, placement));
  const width = Math.round(Math.min(92, Math.max(13, height * spineRatio(placement, book))));
  return { width, height };
}

function surname(author: string | null) {
  if (!author) return "";
  const first = author.split(/,|&| and /i)[0].trim();
  const parts = first.split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

/** Just the picture of the book; used on the shelf and while dragging. */
export const SpineVisual = memo(function SpineVisual({
  look,
  orientation = "upright",
  lifted = false,
}: {
  look: SpineLook;
  orientation?: "upright" | "flat";
  lifted?: boolean;
}) {
  const { book, placement, photo, usePhoto } = look;
  const { width, height } = spineSize(look);
  const color = placement?.spine_color || paintedColor(book);
  const ink = readableText(color, placement?.spine_text ?? "auto");
  const showPhoto = showsPhoto(placement, photo, usePhoto);
  const fontClass = placement?.spine_font === "sans" ? "font-sans tracking-wide uppercase" : "font-classical";
  const photoFilter = `brightness(${placement?.photo_brightness ?? 1})`;
  const flip = placement?.photo_flip ? " rotate(180deg)" : "";

  const flat = orientation === "flat";
  // Lying flat: the book's height becomes its length, the spine width its thickness
  const boxW = flat ? Math.round(height * 0.92) : width;
  const boxH = flat ? width : height;

  const style: CSSProperties = {
    width: boxW,
    height: boxH,
    backgroundColor: color,
    color: ink,
  };

  const titleSize = flat ? Math.min(12, Math.max(8, boxH * 0.42)) : Math.min(13, Math.max(8.5, width * 0.38));

  return (
    <span
      style={style}
      className={`relative block overflow-hidden select-none rounded-[3px] ${
        flat ? "rounded-r-[5px]" : "rounded-t-[4px]"
      } shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12),0_1px_2px_rgba(15,23,42,0.25)] ${
        lifted ? "shadow-[0_18px_40px_rgba(15,23,42,0.35)] ring-2 ring-[#c69a3d]" : ""
      }`}
    >
      {showPhoto ? (
        <img
          src={photo!}
          alt=""
          draggable={false}
          className={`absolute object-cover ${flat ? "max-w-none" : "inset-0 w-full h-full"}`}
          // Lying flat: the upright photo is turned a quarter turn to lie along the book
          style={
            flat
              ? { width: boxH, height: boxW, left: (boxW - boxH) / 2, top: (boxH - boxW) / 2, transform: `rotate(-90deg)${flip}`, filter: photoFilter }
              : { transform: flip || undefined, filter: photoFilter }
          }
        />
      ) : (
        <>
          {/* Foil bands */}
          {!flat && height > 90 && (
            <>
              <span aria-hidden="true" className="absolute inset-x-[3px] top-[7%] h-[2px] rounded-full opacity-50" style={{ backgroundColor: ink }} />
              <span aria-hidden="true" className="absolute inset-x-[3px] bottom-[7%] h-[2px] rounded-full opacity-50" style={{ backgroundColor: ink }} />
            </>
          )}

          {flat ? (
            <span className="absolute inset-0 flex items-center gap-2 px-2 whitespace-nowrap" style={{ fontSize: titleSize }}>
              <span className={`${fontClass} font-semibold truncate`}>{book.title}</span>
              {boxH >= 16 && book.author && <span className="opacity-60 text-[0.85em] truncate">{surname(book.author)}</span>}
            </span>
          ) : (
            <span
              className="absolute inset-0 flex items-center justify-between py-[12%] [writing-mode:vertical-rl]"
              style={{ fontSize: titleSize }}
            >
              <span className={`${fontClass} font-semibold leading-none truncate max-h-[74%]`}>{book.title}</span>
              {width >= 20 && book.author && <span className="leading-none opacity-65 text-[0.8em] truncate max-h-[22%]">{surname(book.author)}</span>}
            </span>
          )}
        </>
      )}

      {/* Rounded-spine shading */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: flat
            ? "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(0,0,0,0) 40%, rgba(0,0,0,0.22))"
            : "linear-gradient(90deg, rgba(0,0,0,0.28), rgba(255,255,255,0.14) 30%, rgba(255,255,255,0.05) 60%, rgba(0,0,0,0.3))",
        }}
      />
    </span>
  );
});

/** A spine you can click (view mode) or drag (arrange mode). */
export default function Spine({
  look,
  orientation,
  container,
  arranging,
  dimmed,
  onSelect,
}: {
  look: SpineLook;
  orientation: "upright" | "flat";
  container: string;
  arranging: boolean;
  dimmed: boolean;
  onSelect: (bookId: string) => void;
}) {
  const { book } = look;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: book.id,
    data: { container },
    disabled: !arranging,
  });

  const label = `${book.title}${book.author ? ` by ${book.author}` : ""}`;

  return (
    <button
      ref={setNodeRef}
      type="button"
      data-spine-id={book.id}
      title={label}
      aria-label={arranging ? `${label}. Drag to move, or press Enter for options.` : `${label}. Show where it is.`}
      onClick={() => onSelect(book.id)}
      {...(arranging ? listeners : {})}
      {...(arranging ? attributes : {})}
      className={`spine-btn group relative block shrink-0 rounded-[4px] transition-[transform,opacity,filter] duration-200 ${focusRing} focus-visible:ring-offset-[#3b2a1c] ${
        arranging ? "cursor-grab active:cursor-grabbing touch-manipulation" : "cursor-pointer"
      } ${isDragging ? "opacity-25 saturate-0" : dimmed ? "opacity-30" : "hover:-translate-y-1.5"}`}
    >
      <SpineVisual look={look} orientation={orientation} />
    </button>
  );
}
