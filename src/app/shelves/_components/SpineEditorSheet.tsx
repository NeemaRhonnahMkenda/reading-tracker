// src/app/shelves/_components/SpineEditorSheet.tsx
// Change how a book looks on the shelf: use the spine photo or a painted
// spine, fix an upside-down or dark photo, take a new one, pick the colour,
// lettering and size. A live preview shows it standing and lying flat.

"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Modal, { ModalHeader } from "../../components/ui/Modal";
import Button, { focusRing } from "../../components/ui/Button";
import { supabase } from "../../../lib/supabase";
import {
  PAINTED,
  SPINE_BUCKET,
  emptyPlacement,
  heightRatio,
  paintedColor,
  saveSpineLook,
  showsPhoto,
  signSpines,
  spineRatio,
  type Placement,
  type ShelfBook,
  type SpineFont,
  type SpineLookFields,
  type SpineStyle,
  type SpineText,
} from "../_lib/shelves";
import { canvasFromFile, makeShot } from "../_lib/spineCapture";
import { SpineVisual } from "./Spine";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

interface NewPhoto {
  blob: Blob;
  preview: string; // data URL
  color: string;
  ratio: number;
}

// Average colour of an image already on screen (signed storage URLs allow this)
async function colorFromUrl(url: string) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = 24;
  c.height = 60;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, img.width * 0.2, img.height * 0.15, img.width * 0.6, img.height * 0.7, 0, 0, 24, 60);
  const { data } = ctx.getImageData(0, 0, 24, 60);
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const n = data.length / 4;
  return `#${[r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("")}`;
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500 mb-1.5">{label}</p>
      <div role="radiogroup" aria-label={label} className="grid p-1 rounded-full bg-[#0f172a]/[0.05]" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`h-9 rounded-full text-sm font-medium transition-all disabled:opacity-35 ${focusRing} ${
              value === o.value ? "bg-white text-[#0f172a] shadow-sm" : "text-slate-500 hover:text-[#0f172a]"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="font-classical text-lg font-semibold text-[#0f172a]">{title}</h3>
      {children}
    </section>
  );
}

export default function SpineEditorSheet({
  book,
  placement,
  photoUrl,
  pagePrefersPhoto,
  userId,
  onClose,
  onSaved,
}: {
  book: ShelfBook | null;
  placement: Placement | undefined;
  photoUrl: string | null;
  pagePrefersPhoto: boolean;
  userId: string;
  onClose: () => void;
  onSaved: (placement: Placement, photoUrl: string | null) => void;
}) {
  const open = !!book;
  const [draft, setDraft] = useState<Placement | null>(null);
  const [newPhoto, setNewPhoto] = useState<NewPhoto | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [photoColor, setPhotoColor] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pasting, setPasting] = useState(false);
  const [notice, setNotice] = useState("");
  const [pasteKeys, setPasteKeys] = useState<string | null>(null); // "Ctrl+V" / "⌘V", null on touch screens
  const imageHandlerRef = useRef<(image: Blob) => void>(() => undefined);

  // Show the keyboard shortcut only where there's a keyboard
  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    const mac = /Mac|iPhone|iPad/.test(navigator.userAgent);
    setPasteKeys(fine ? (mac ? "⌘V" : "Ctrl+V") : null);
  }, []);

  // Paste an image anywhere while the editor is open (Ctrl+V / ⌘V)
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const image = items.find((i) => i.kind === "file" && i.type.startsWith("image/"))?.getAsFile();
      if (image) {
        e.preventDefault();
        imageHandlerRef.current(image);
        return;
      }
      // A copied link isn't the image itself (and most sites won't let us fetch it)
      const text = e.clipboardData?.getData("text/plain")?.trim() ?? "";
      const inField = e.target instanceof HTMLElement && !!e.target.closest("input, textarea, [contenteditable]");
      if (!inField && /^https?:\/\//i.test(text)) {
        setError("That's a link, not an image. Right-click the image, choose Copy image, then paste again.");
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(""), 2500);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!book) return;
    setDraft({ ...(placement ?? emptyPlacement(book.id)) });
    setNewPhoto(null);
    setRemovePhoto(false);
    setError("");
    setNotice("");
    setPhotoColor(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.id]);

  // Colour of the existing photo, for the "match photo" swatch
  useEffect(() => {
    if (!photoUrl || !open) return;
    let cancelled = false;
    colorFromUrl(photoUrl)
      .then((c) => !cancelled && setPhotoColor(c))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [photoUrl, open]);

  const currentPhoto = newPhoto?.preview ?? (removePhoto ? null : photoUrl);
  const hasPhoto = !!currentPhoto;
  const matchColor = newPhoto?.color ?? (removePhoto ? null : photoColor);

  // What the preview draws: the draft with a (pretend) path when there's any photo
  const previewPlacement = useMemo<Placement | undefined>(() => {
    if (!draft) return undefined;
    return { ...draft, spine_path: hasPhoto ? draft.spine_path ?? "preview" : null };
  }, [draft, hasPhoto]);

  if (!book) {
    return <Modal open={false} onClose={onClose} labelledBy="spine-edit-title">{null}</Modal>;
  }

  const set = <K extends keyof Placement>(key: K, value: Placement[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const usingPhoto = !!draft && showsPhoto(previewPlacement, currentPhoto, pagePrefersPhoto);
  const color = draft?.spine_color || paintedColor(book);
  const thickness = draft ? spineRatio(draft, book) : 0.08;
  const height = draft ? heightRatio(book.id, draft) : 0.85;

  async function pickPhoto(file: File | undefined, how: "chosen" | "pasted" = "chosen") {
    if (!file) return;
    setError("");
    if (file.size > MAX_IMAGE_BYTES) {
      setError("That image is over 15 MB. Try a smaller one.");
      return;
    }
    try {
      const shot = await makeShot(await canvasFromFile(file));
      if (!shot.blob) throw new Error("no blob");
      setNewPhoto({ blob: shot.blob, preview: shot.thumb, color: shot.color, ratio: shot.ratio });
      setRemovePhoto(false);
      setDraft((d) => (d ? { ...d, spine_style: "photo", photo_flip: false, photo_brightness: 1 } : d));
      if (how === "pasted") setNotice("Image pasted. Save to keep it.");
    } catch (err) {
      console.error("Spine photo failed:", err);
      setError("That photo couldn't be used. Try a JPG or PNG of the spine.");
    } finally {
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Pasted images arrive as a Blob; give them a name and type like a chosen file
  function takeImage(image: Blob) {
    const type = image.type || "image/png";
    const name = image instanceof File && image.name ? image.name : `pasted-spine.${type.split("/")[1] || "png"}`;
    pickPhoto(image instanceof File ? image : new File([image], name, { type }), "pasted");
  }
  imageHandlerRef.current = takeImage;

  // The Paste button reads the clipboard directly (asks permission in some browsers)
  async function pasteFromClipboard() {
    setError("");
    const keys = pasteKeys ?? "your keyboard's paste shortcut";
    if (!navigator.clipboard?.read) {
      setError(`This browser can't paste from a button. Press ${keys} instead.`);
      return;
    }
    setPasting(true);
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) {
          takeImage(await item.getType(type));
          return;
        }
      }
      setError("There's no image on your clipboard. Copy an image first, then paste.");
    } catch (err) {
      const blocked = (err as Error)?.name === "NotAllowedError";
      setError(
        blocked
          ? `Clipboard access was blocked. Allow it for this site, or press ${keys} to paste.`
          : "The clipboard couldn't be read. Copy the image again and retry."
      );
    } finally {
      setPasting(false);
    }
  }

  function resetLook() {
    setDraft((d) =>
      d ? { ...d, spine_style: "auto", spine_text: "auto", spine_font: "serif", height_ratio: null, photo_flip: false, photo_brightness: 1 } : d
    );
  }

  async function save() {
    if (!draft || !book) return;
    setSaving(true);
    setError("");
    let uploaded: string | null = null;
    const oldPath = placement?.spine_path ?? null;

    try {
      if (newPhoto) {
        uploaded = `${userId}/${crypto.randomUUID()}.jpg`;
        const { error: upError } = await supabase.storage
          .from(SPINE_BUCKET)
          .upload(uploaded, newPhoto.blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
        if (upError) throw upError;
      }

      const nextPath = uploaded ?? (removePhoto ? null : oldPath);
      const look: Partial<SpineLookFields> = {
        spine_style: removePhoto && !uploaded ? "auto" : draft.spine_style,
        spine_text: draft.spine_text,
        spine_font: draft.spine_font,
        spine_color: draft.spine_color,
        spine_ratio: draft.spine_ratio,
        height_ratio: draft.height_ratio,
        photo_flip: draft.photo_flip,
        photo_brightness: Number(draft.photo_brightness.toFixed(2)),
        spine_path: nextPath,
      };

      const saved = await saveSpineLook(userId, book.id, look);

      if (oldPath && oldPath !== nextPath) {
        const { error: rmError } = await supabase.storage.from(SPINE_BUCKET).remove([oldPath]);
        if (rmError) console.error("Old spine photo cleanup failed:", rmError.message);
      }

      const url = nextPath ? (await signSpines([nextPath]))[nextPath] ?? null : null;
      onSaved(saved, url);
    } catch (err) {
      console.error("Saving the spine look failed:", err);
      if (uploaded) await supabase.storage.from(SPINE_BUCKET).remove([uploaded]);
      const e = err as { code?: string };
      setError(e?.code === "42703" ? "Run shelves-v2.sql in Supabase to enable spine editing." : "The spine couldn't be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const swatches = Array.from(new Set([...(matchColor ? [matchColor] : []), ...PAINTED]));

  return (
    <Modal open={open} onClose={onClose} labelledBy="spine-edit-title" size="lg" dismissible={!saving}>
      <div className="px-5 sm:px-8 pt-3 sm:pt-7 pb-4 border-b border-[#0f172a]/[0.06]">
        <div className="sm:hidden mx-auto mb-4 h-1 w-10 rounded-full bg-[#0f172a]/15" aria-hidden="true" />
        <ModalHeader id="spine-edit-title" title="Spine look" description={book.title} onClose={onClose} disabled={saving} />
      </div>

      {draft && (
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="grid md:grid-cols-[220px_minmax(0,1fr)]">
            {/* ---------- Preview (pinned while you scroll the options) ---------- */}
            <div className="sticky top-0 z-10 bg-[#fdfaf3] md:self-start px-5 sm:px-8 md:pr-0 pt-4 md:pt-5 pb-3 md:pb-6 border-b border-[#0f172a]/[0.06] md:border-0">
              <div className="rounded-2xl p-1.5 md:p-2 bg-[linear-gradient(135deg,#9b7448,#6a4a2b)] shadow-lg">
                <div className="rounded-lg overflow-hidden">
                  <div className="flex items-end justify-center gap-[2px] px-3 pt-2 h-[132px] md:h-[230px] bg-[linear-gradient(180deg,#2b1f15,#4a3524)]" aria-hidden="true">
                    <span className="block w-[14px] md:w-[18px] h-[70%] rounded-t-[3px] bg-[#3d5a45] opacity-60" />
                    <span className="md:hidden">
                      <SpineVisual look={{ book, placement: previewPlacement, photo: currentPhoto, usePhoto: pagePrefersPhoto, shelfHeight: 120 }} orientation="upright" />
                    </span>
                    <span className="hidden md:block">
                      <SpineVisual look={{ book, placement: previewPlacement, photo: currentPhoto, usePhoto: pagePrefersPhoto, shelfHeight: 215 }} orientation="upright" />
                    </span>
                    <span className="block w-[16px] md:w-[22px] h-[78%] rounded-t-[3px] bg-[#7a3f33] opacity-60" />
                    {/* Lying flat beside it on phones */}
                    <span className="md:hidden ml-3">
                      <SpineVisual look={{ book, placement: previewPlacement, photo: currentPhoto, usePhoto: pagePrefersPhoto, shelfHeight: 190 }} orientation="flat" />
                    </span>
                  </div>
                  <div className="h-2.5 md:h-3 bg-[linear-gradient(180deg,#c9a274,#7d5c37)]" />
                </div>
              </div>

              {/* Lying flat, bigger, on wider screens */}
              <div className="hidden md:flex mt-4 justify-center rounded-xl bg-[#f3eee3] px-2 py-4" aria-hidden="true">
                <SpineVisual look={{ book, placement: previewPlacement, photo: currentPhoto, usePhoto: pagePrefersPhoto, shelfHeight: 210 }} orientation="flat" />
              </div>
              <p className="mt-2 text-center text-xs text-slate-500">Standing and lying flat</p>
            </div>

            {/* ---------- Controls ---------- */}
            <div className="px-5 sm:px-8 py-5 sm:py-6 space-y-7">
              <Section title="Style">
                <Segmented<SpineStyle>
                  label="Show"
                  value={draft.spine_style === "auto" ? (usingPhoto ? "photo" : "painted") : draft.spine_style}
                  options={[
                    { value: "photo", label: "Photo", disabled: !hasPhoto },
                    { value: "painted", label: "Painted" },
                  ]}
                  onChange={(v) => set("spine_style", v)}
                />

                <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} onChange={(e) => pickPhoto(e.target.files?.[0])} />
                <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => pickPhoto(e.target.files?.[0])} />
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => cameraRef.current?.click()}>
                    {hasPhoto ? "Retake photo" : "Take a spine photo"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                    Choose photo
                  </Button>
                  <Button variant="outline" size="sm" onClick={pasteFromClipboard} loading={pasting}>
                    {!pasting && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="8" y="3" width="8" height="4" rx="1" />
                        <path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
                      </svg>
                    )}
                    Paste image
                  </Button>
                  {hasPhoto && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setNewPhoto(null);
                        setRemovePhoto(true);
                        set("spine_style", "auto");
                      }}
                    >
                      Remove photo
                    </Button>
                  )}
                </div>
                <p className="text-xs text-slate-500" aria-live="polite">
                  {notice ? (
                    <span className="text-[#4a5c4b] font-medium">✓ {notice}</span>
                  ) : pasteKeys ? (
                    <>Copied an image? Press <kbd className="px-1.5 py-0.5 rounded bg-[#0f172a]/[0.06] font-sans text-[11px]">{pasteKeys}</kbd> to paste it here.</>
                  ) : (
                    "Copied an image? Tap Paste image."
                  )}
                </p>
              </Section>

              {usingPhoto && (
                <Section title="Photo">
                  <label className="flex items-center justify-between gap-3 rounded-2xl bg-white border border-[#0f172a]/10 px-4 py-3 cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#7a947c]">
                    <span>
                      <span className="block text-sm font-medium text-[#0f172a]">Turn upside down</span>
                      <span className="block text-xs text-slate-500">If the photo was taken the wrong way round</span>
                    </span>
                    <input type="checkbox" checked={draft.photo_flip} onChange={(e) => set("photo_flip", e.target.checked)} className="w-5 h-5 accent-[#7a947c]" />
                  </label>
                  <label className="block">
                    <span className="flex justify-between text-xs font-medium text-slate-500 mb-1.5">
                      <span>Brightness</span>
                      <span className="tabular-nums">{Math.round(draft.photo_brightness * 100)}%</span>
                    </span>
                    <input
                      type="range"
                      min={0.5}
                      max={1.6}
                      step={0.05}
                      value={draft.photo_brightness}
                      onChange={(e) => set("photo_brightness", Number(e.target.value))}
                      className="w-full accent-[#7a947c]"
                    />
                  </label>
                </Section>
              )}

              {!usingPhoto && (
                <>
                  <Section title="Colour">
                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Spine colour">
                      {swatches.map((c, i) => (
                        <button
                          key={c}
                          type="button"
                          role="radio"
                          aria-checked={color === c}
                          aria-label={i === 0 && c === matchColor ? "Match the photo" : `Colour ${c}`}
                          title={i === 0 && c === matchColor ? "Match the photo" : c}
                          onClick={() => set("spine_color", c)}
                          className={`relative w-9 h-9 rounded-full ring-1 ring-black/10 transition-transform ${focusRing} ${color === c ? "scale-110 ring-2 ring-offset-2 ring-[#0f172a]" : "hover:scale-105"}`}
                          style={{ backgroundColor: c }}
                        >
                          {i === 0 && c === matchColor && <span className="absolute -bottom-1 -right-1 text-[9px] bg-white rounded-full px-1 shadow">📷</span>}
                        </button>
                      ))}
                      <label className={`relative w-9 h-9 rounded-full ring-1 ring-black/10 overflow-hidden cursor-pointer bg-[conic-gradient(#f87171,#facc15,#4ade80,#60a5fa,#c084fc,#f87171)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#7a947c]`} title="Any colour">
                        <span className="sr-only">Pick any colour</span>
                        <input type="color" value={color} onChange={(e) => set("spine_color", e.target.value.toLowerCase())} className="absolute inset-0 opacity-0 cursor-pointer" />
                      </label>
                    </div>
                  </Section>

                  <Section title="Lettering">
                    <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-4">
                      <Segmented<SpineFont>
                        label="Font"
                        value={draft.spine_font}
                        options={[
                          { value: "serif", label: "Classic" },
                          { value: "sans", label: "Modern" },
                        ]}
                        onChange={(v) => set("spine_font", v)}
                      />
                      <Segmented<SpineText>
                        label="Text colour"
                        value={draft.spine_text}
                        options={[
                          { value: "auto", label: "Auto" },
                          { value: "light", label: "Light" },
                          { value: "dark", label: "Dark" },
                        ]}
                        onChange={(v) => set("spine_text", v)}
                      />
                    </div>
                  </Section>
                </>
              )}

              <Section title="Size">
                <label className="block">
                  <span className="flex justify-between text-xs font-medium text-slate-500 mb-1.5">
                    <span>Thickness</span>
                    <span>{thickness < 0.06 ? "Thin" : thickness < 0.13 ? "Medium" : "Thick"}</span>
                  </span>
                  <input
                    type="range"
                    min={0.02}
                    max={0.3}
                    step={0.005}
                    value={thickness}
                    onChange={(e) => set("spine_ratio", Number(e.target.value))}
                    className="w-full accent-[#7a947c]"
                  />
                </label>
                <label className="block">
                  <span className="flex justify-between text-xs font-medium text-slate-500 mb-1.5">
                    <span>Height</span>
                    <span>{height < 0.75 ? "Short" : height < 0.9 ? "Standard" : "Tall"}</span>
                  </span>
                  <input
                    type="range"
                    min={0.6}
                    max={1}
                    step={0.01}
                    value={height}
                    onChange={(e) => set("height_ratio", Number(e.target.value))}
                    className="w-full accent-[#7a947c]"
                  />
                </label>
              </Section>

              <button
                type="button"
                onClick={resetLook}
                className={`text-xs font-medium text-slate-500 underline underline-offset-4 decoration-slate-300 hover:text-[#0f172a] rounded ${focusRing}`}
              >
                Reset style, lettering and height
              </button>

              {error && <p role="alert" className="px-4 py-3 rounded-xl bg-[#fbefed] border border-red-200/70 text-[#a14e43] text-sm">{error}</p>}
            </div>
          </div>
        </div>
      )}

      <div className="px-5 sm:px-8 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:py-5 border-t border-[#0f172a]/[0.06] flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="dark" onClick={save} loading={saving}>
          {saving ? "Saving…" : "Save look"}
        </Button>
      </div>
    </Modal>
  );
}
