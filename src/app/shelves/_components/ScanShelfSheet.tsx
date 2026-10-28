// src/app/shelves/_components/ScanShelfSheet.tsx
// Scan a shelf one spine at a time, like the barcode scanner:
//   1. Choose the shelf you're standing in front of
//   2. Fit each spine into the frame, left to right. When the text matches a
//      book in your library, confirm it (or pick the right one). Books that
//      aren't in your library can't be added.
//   3. Check the order and save. Only the small spine strips are uploaded.

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Modal, { ModalHeader } from "../../components/ui/Modal";
import Button, { focusRing } from "../../components/ui/Button";
import { supabase } from "../../../lib/supabase";
import { SPINE_BUCKET, TRAY, type Bookcase, type Layout, type Shelf, type ShelfBook } from "../_lib/shelves";
import { createSpineReader, type SpineReader } from "../_lib/ocr";
import { indexBooks, matchLevel, rankBooks, type MatchCandidate } from "../_lib/match";
import { FULL_RECT, canvasFromFile, makeShot, trimCanvas, type CropRect, type SpineShot } from "../_lib/spineCapture";
import SpineViewfinder from "./SpineViewfinder";
import SpineCropper from "./SpineCropper";

type Step = "setup" | "scan";

// The picture a spine strip was cut from, so the crop can be adjusted later
interface SpineSource {
  picture: HTMLCanvasElement;
  rect: CropRect;
}

interface Proposal {
  shot: SpineShot;
  source: SpineSource;
  ownPhoto: boolean; // false = the frame auto-captured while reading
  text: string;
  candidates: MatchCandidate[];
  bookId: string; // "" = nothing in the library matched
}

interface Captured {
  key: string;
  bookId: string;
  shot: SpineShot;
  source: SpineSource;
  ownPhoto: boolean;
}

// Whose spine photo is being taken or adjusted: the match on screen, or a book already added
type PhotoTarget = "proposal" | string;

const ASK_PHOTO_KEY = "archive:scan-ask-photo";

const AUTO_ACCEPT = 0.55; // a match this good, seen twice in a row, pops up for confirmation
const INSTANT_ACCEPT = 0.82; // this good: pops up straight away

const selectClass = `w-full h-11 pl-3.5 pr-9 rounded-xl bg-white border border-[#0f172a]/10 text-base sm:text-sm text-slate-700 appearance-none bg-no-repeat bg-[right_0.8rem_center] bg-[url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>")] focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10`;

async function uploadShots(userId: string, items: Captured[]) {
  const paths = new Map<string, string>();
  const queue = [...items];
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift()!;
      if (!item.shot.blob) continue;
      const path = `${userId}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage
        .from(SPINE_BUCKET)
        .upload(path, item.shot.blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
      if (error) throw error;
      paths.set(item.key, path);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return paths;
}

export default function ScanShelfSheet({
  open,
  userId,
  bookcases,
  shelves,
  layout,
  books,
  initialShelfId,
  onClose,
  onSaved,
}: {
  open: boolean;
  userId: string;
  bookcases: Bookcase[];
  shelves: Shelf[];
  layout: Layout;
  books: ShelfBook[];
  initialShelfId: string | null;
  onClose: () => void;
  onSaved: (shelfId: string, firstBookId: string | null, count: number) => void;
}) {
  const [step, setStep] = useState<Step>("setup");
  const [caseId, setCaseId] = useState("");
  const [shelfId, setShelfId] = useState("");
  const [replace, setReplace] = useState(true);

  const [cameraError, setCameraError] = useState("");
  const [readerState, setReaderState] = useState<"off" | "loading" | "ready" | "failed">("off");
  const [liveText, setLiveText] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [captured, setCaptured] = useState<Captured[]>([]);
  const [flash, setFlash] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const readerRef = useRef<SpineReader | null>(null);
  const readerPromiseRef = useRef<Promise<SpineReader> | null>(null);
  const streakRef = useRef<{ bookId: string; count: number }>({ bookId: "", count: 0 });
  const capturedRef = useRef(captured);
  capturedRef.current = captured;
  const photoRef = useRef<HTMLInputElement | null>(null);

  // Spine photos: take your own, adjust the crop, or choose one
  const [askPhoto, setAskPhoto] = useState(true);
  const [photoFor, setPhotoFor] = useState<PhotoTarget | null>(null);
  const [cropping, setCropping] = useState<{ target: PhotoTarget; picture: HTMLCanvasElement; rect: CropRect } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const spineFileRef = useRef<HTMLInputElement | null>(null);
  const spineFileTargetRef = useRef<PhotoTarget | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(ASK_PHOTO_KEY) === "0") setAskPhoto(false);
    } catch {
      // storage unavailable
    }
  }, []);

  function changeAskPhoto(value: boolean) {
    setAskPhoto(value);
    try {
      localStorage.setItem(ASK_PHOTO_KEY, value ? "1" : "0");
    } catch {
      // storage unavailable
    }
  }

  const bookMap = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);
  const photoTitle = (target: PhotoTarget) => {
    const id = target === "proposal" ? proposal?.bookId : captured.find((c) => c.key === target)?.bookId;
    return (id && bookMap.get(id)?.title) || "this book";
  };
  const index = useMemo(() => indexBooks(books), [books]);

  const shelvesByCase = useMemo(() => {
    const map = new Map<string, Shelf[]>();
    shelves.forEach((s) => map.set(s.bookcase_id, [...(map.get(s.bookcase_id) ?? []), s]));
    map.forEach((l) => l.sort((a, b) => a.position - b.position));
    return map;
  }, [shelves]);

  const shelfOf = useMemo(() => {
    const m = new Map<string, string>();
    Object.entries(layout).forEach(([sid, ids]) => ids.forEach((id) => m.set(id, sid)));
    return m;
  }, [layout]);

  function shelfName(sid: string) {
    const s = shelves.find((x) => x.id === sid);
    if (!s) return "another shelf";
    const c = bookcases.find((x) => x.id === s.bookcase_id);
    return `${c?.name ?? "Bookcase"} · ${s.label || `Shelf ${s.position + 1}`}`;
  }

  // ---------- Open / close ----------
  useEffect(() => {
    if (!open) return;
    const start = shelves.find((s) => s.id === initialShelfId) ?? shelves[0];
    setCaseId(start?.bookcase_id ?? "");
    setShelfId(start?.id ?? "");
    setStep("setup");
    setReplace(true);
    setCameraError("");
    setLiveText("");
    setProposal(null);
    setCaptured([]);
    setSearch("");
    setError("");
    setPhotoFor(null);
    setCropping(null);
    setExpanded(null);
    streakRef.current = { bookId: "", count: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Stop the reader when the sheet closes
  useEffect(() => {
    if (open) return;
    const reader = readerRef.current;
    readerRef.current = null;
    readerPromiseRef.current = null;
    setReaderState("off");
    reader?.terminate().catch(() => undefined);
  }, [open]);

  useEffect(() => () => void readerRef.current?.terminate().catch(() => undefined), []);

  async function getReader() {
    if (readerRef.current) return readerRef.current;
    if (!readerPromiseRef.current) {
      setReaderState("loading");
      readerPromiseRef.current = createSpineReader()
        .then((r) => {
          readerRef.current = r;
          setReaderState("ready");
          return r;
        })
        .catch((err) => {
          readerPromiseRef.current = null;
          setReaderState("failed");
          throw err;
        });
    }
    return readerPromiseRef.current;
  }

  function startScanning() {
    setError("");
    setStep("scan");
    getReader().catch((err) => console.error("Spine reader failed to load:", err));
  }

  function close() {
    if (saving) return;
    if (captured.length > 0 && !window.confirm(`Discard the ${captured.length} ${captured.length === 1 ? "book" : "books"} you've scanned?`)) return;
    onClose();
  }

  // ---------- Reading ----------
  const alreadyAdded = (bookId: string) => capturedRef.current.findIndex((c) => c.bookId === bookId);

  async function handleRead(crop: HTMLCanvasElement, manual: boolean) {
    let reader: SpineReader;
    try {
      reader = await getReader();
    } catch {
      return;
    }

    const read = await reader.read(crop);
    const candidates = rankBooks(read.text, index, 6);
    const best = candidates[0];

    if (!manual) {
      setLiveText(read.text);
      if (!best || best.score < AUTO_ACCEPT) {
        streakRef.current = { bookId: "", count: 0 };
        return;
      }
      // Don't keep offering the book you've just added; wait for the next one
      if (alreadyAdded(best.bookId) >= 0) {
        setFlash(`${bookMap.get(best.bookId)?.title} is already added. Move to the next book.`);
        return;
      }
      const s = streakRef.current;
      streakRef.current = { bookId: best.bookId, count: s.bookId === best.bookId ? s.count + 1 : 1 };
      if (best.score < INSTANT_ACCEPT && streakRef.current.count < 2) return;
    }

    streakRef.current = { bookId: "", count: 0 };
    const usable = best && best.score >= 0.33 ? best.bookId : "";
    setSearch("");
    setProposal({ shot: await makeShot(crop), source: { picture: crop, rect: FULL_RECT }, ownPhoto: false, text: read.text, candidates, bookId: usable });
    navigator.vibrate?.(25);
    // Found it: now take the spine photo you actually want to keep
    if (askPhoto && usable) {
      setCropping(null);
      setPhotoFor("proposal");
    }
  }

  async function readPhoto(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      const canvas = await canvasFromFile(file);
      await handleRead(canvas, true);
    } catch (err) {
      console.error("Spine photo failed:", err);
      setError("That photo couldn't be read. Try another, with one spine filling most of the picture.");
    } finally {
      if (photoRef.current) photoRef.current.value = "";
    }
  }

  // ---------- Confirm ----------
  function confirm() {
    if (!proposal?.bookId || alreadyAdded(proposal.bookId) >= 0) return;
    const book = bookMap.get(proposal.bookId);
    setCaptured((cur) => [
      ...cur,
      { key: crypto.randomUUID(), bookId: proposal.bookId, shot: proposal.shot, source: proposal.source, ownPhoto: proposal.ownPhoto },
    ]);
    clearProposal();
    setLiveText("");
    setFlash(`Added ${book?.title ?? "book"}. Next spine to the right.`);
    navigator.vibrate?.([20, 40, 20]);
  }

  function clearProposal() {
    setProposal(null);
    if (photoFor === "proposal") setPhotoFor(null);
    if (cropping?.target === "proposal") setCropping(null);
  }

  // ---------- Spine photos ----------
  function startPhoto(target: PhotoTarget) {
    setError("");
    setCropping(null);
    setPhotoFor(target);
  }

  function onCapture(picture: HTMLCanvasElement, guide: CropRect) {
    if (!photoFor) return;
    setCropping({ target: photoFor, picture, rect: guide });
  }

  function adjustPhoto(target: PhotoTarget) {
    const source = target === "proposal" ? proposal?.source : captured.find((c) => c.key === target)?.source;
    if (!source) return;
    setPhotoFor(null);
    setCropping({ target, picture: source.picture, rect: source.rect });
  }

  function choosePhoto(target: PhotoTarget) {
    spineFileTargetRef.current = target;
    spineFileRef.current?.click();
  }

  async function onSpineFile(file: File | undefined) {
    const target = spineFileTargetRef.current;
    if (spineFileRef.current) spineFileRef.current.value = "";
    if (!file || !target) return;
    try {
      const picture = await canvasFromFile(file);
      setPhotoFor(null);
      setCropping({ target, picture, rect: FULL_RECT });
    } catch {
      setError("That photo couldn't be opened. Try a JPG or PNG.");
    }
  }

  async function applyCrop(rect: CropRect) {
    if (!cropping) return;
    const { target, picture } = cropping;
    const shot = await makeShot(trimCanvas(picture, rect));
    const source = { picture, rect };
    if (target === "proposal") setProposal((p) => (p ? { ...p, shot, source, ownPhoto: true } : p));
    else setCaptured((cur) => cur.map((c) => (c.key === target ? { ...c, shot, source, ownPhoto: true } : c)));
    setCropping(null);
    setPhotoFor(null);
    setFlash("Spine photo saved for this book.");
  }

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(""), 2600);
    return () => window.clearTimeout(t);
  }, [flash]);

  const searchResults = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return books
      .filter((b) => b.title.toLowerCase().includes(term) || (b.author ?? "").toLowerCase().includes(term))
      .slice(0, 6);
  }, [books, search]);

  function move(i: number, delta: number) {
    setCaptured((cur) => {
      const j = i + delta;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  // ---------- Save ----------
  async function save() {
    if (!shelfId || captured.length === 0) return;
    setSaving(true);
    setError("");
    let uploaded = new Map<string, string>();

    try {
      uploaded = await uploadShots(userId, captured);
      const items = captured.map((c) => ({
        book_id: c.bookId,
        spine_color: c.shot.color,
        spine_path: uploaded.get(c.key) ?? null,
        spine_ratio: Number(c.shot.ratio.toFixed(4)),
      }));

      const { data, error: rpcError } = await supabase.rpc("save_scanned_shelf", {
        p_shelf_id: shelfId,
        p_items: items,
        p_replace: replace,
      });
      if (rpcError) throw rpcError;

      const unused = (data as string[] | null) ?? [];
      if (unused.length) {
        const { error: removeError } = await supabase.storage.from(SPINE_BUCKET).remove(unused);
        if (removeError) console.error("Old spine cleanup failed:", removeError.message);
      }

      onSaved(shelfId, captured[0]?.bookId ?? null, captured.length);
    } catch (err) {
      console.error("Saving the shelf failed:", err);
      const paths = Array.from(uploaded.values());
      if (paths.length) await supabase.storage.from(SPINE_BUCKET).remove(paths);
      const e = err as { code?: string };
      setError(e?.code === "PGRST202" ? "The shelves database isn't set up yet. Run shelves.sql in Supabase." : "The shelf couldn't be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  // ---------- Status for the viewfinder ----------
  let status = "Fit one spine inside the frame";
  let tone: "idle" | "reading" | "found" | "warn" = "idle";
  if (readerState === "loading") {
    status = "Getting the reader ready…";
    tone = "reading";
  } else if (readerState === "failed") {
    status = "The reader couldn't load. Check your connection.";
    tone = "warn";
  } else if (photoFor) {
    status = "Fit the spine in the frame, then tap the camera";
    tone = "idle";
  } else if (proposal) {
    status = proposal.bookId ? "Found it. Confirm below." : "Not found in your library";
    tone = proposal.bookId ? "found" : "warn";
  } else if (flash) {
    status = flash;
    tone = flash.startsWith("Added") ? "found" : "idle";
  } else if (liveText) {
    status = `Reading: “${liveText.slice(0, 40)}”`;
    tone = "reading";
  }

  const proposedBook = proposal?.bookId ? bookMap.get(proposal.bookId) : null;
  const proposedLevel = proposal?.bookId ? matchLevel(proposal.candidates.find((c) => c.bookId === proposal.bookId)?.score ?? 1) : "none";
  const duplicateAt = proposal?.bookId ? captured.findIndex((c) => c.bookId === proposal.bookId) : -1;
  const elsewhere = proposal?.bookId ? shelfOf.get(proposal.bookId) : undefined;
  const movesFrom = elsewhere && elsewhere !== TRAY && elsewhere !== shelfId ? shelfName(elsewhere) : "";
  const targetName = shelfId ? shelfName(shelfId) : "";

  return (
    <Modal open={open} onClose={close} labelledBy="scan-title" size="lg" dismissible={!saving}>
      <div className="px-5 sm:px-8 pt-3 sm:pt-7 pb-4 border-b border-[#0f172a]/[0.06]">
        <div className="sm:hidden mx-auto mb-4 h-1 w-10 rounded-full bg-[#0f172a]/15" aria-hidden="true" />
        <ModalHeader
          id="scan-title"
          title="Scan a shelf"
          description={step === "setup" ? "Scan each spine, left to right. Pictures stay on this device until you save." : targetName}
          onClose={close}
          disabled={saving}
        />
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-5 sm:px-8 py-5 sm:py-6">
        {/* ================= Setup ================= */}
        {step === "setup" && (
          <div className="space-y-6">
            {bookcases.length === 0 ? (
              <p className="text-sm text-slate-500">Create a bookcase first.</p>
            ) : (
              <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
                <label className="block min-w-0">
                  <span className="block text-xs font-medium text-slate-500 mb-1.5">Bookcase</span>
                  <select
                    value={caseId}
                    onChange={(e) => {
                      setCaseId(e.target.value);
                      setShelfId(shelvesByCase.get(e.target.value)?.[0]?.id ?? "");
                    }}
                    className={selectClass}
                  >
                    {bookcases.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>
                <label className="block min-w-0">
                  <span className="block text-xs font-medium text-slate-500 mb-1.5">Shelf</span>
                  <select value={shelfId} onChange={(e) => setShelfId(e.target.value)} className={selectClass}>
                    {(shelvesByCase.get(caseId) ?? []).map((s, i, all) => (
                      <option key={s.id} value={s.id}>
                        {s.label || `Shelf ${s.position + 1}`}
                        {i === 0 ? " (top)" : i === all.length - 1 ? " (bottom)" : ""} · {(layout[s.id] ?? []).length} books
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            <ol className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[
                ["Start at the left", "Scan the books in the order they stand."],
                ["Fit the frame", "One spine inside the gold frame; slide to match its thickness."],
                ["Confirm and photograph", "We match it to your library, then you take the spine photo to keep. Tap Add."],
              ].map(([title, text], i) => (
                <li key={title} className="rounded-2xl bg-[#f3eee3] px-3.5 py-3">
                  <span className="text-xs font-semibold text-[#8a6a22]">{i + 1}.</span>{" "}
                  <span className="text-sm font-medium text-[#0f172a]">{title}</span>
                  <span className="block text-xs text-slate-500 mt-0.5 leading-5">{text}</span>
                </li>
              ))}
            </ol>

            <fieldset>
              <legend className="block text-xs font-medium text-slate-500 mb-2">Books already on this shelf</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { value: true, label: "Replace them", hint: "The shelf will match what you scan" },
                  { value: false, label: "Keep them", hint: "Scanned books go at the right end" },
                ].map((o) => {
                  const checked = replace === o.value;
                  return (
                    <label
                      key={String(o.value)}
                      className={`cursor-pointer rounded-2xl border px-4 py-3 transition-all has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#7a947c] ${
                        checked ? "border-[#7a947c] bg-[#eef3ee]" : "border-[#0f172a]/10 bg-white hover:border-[#7a947c]/50"
                      }`}
                    >
                      <input type="radio" name="scan-mode" checked={checked} onChange={() => setReplace(o.value)} className="sr-only" />
                      <span className="block text-sm font-medium text-[#0f172a]">{o.label}</span>
                      <span className="block text-xs text-slate-500 mt-0.5">{o.hint}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>
        )}

        {/* ================= Scan ================= */}
        {step === "scan" && (
          <div className="space-y-5">
            <input ref={photoRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => readPhoto(e.target.files?.[0])} />
            <input ref={spineFileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => onSpineFile(e.target.files?.[0])} />

            {cameraError ? (
              <div className="rounded-2xl border-2 border-dashed border-[#0f172a]/15 bg-white p-6 text-center">
                <p className="text-sm text-[#a14e43]">{cameraError}</p>
                <Button variant="dark" className="mt-4" onClick={() => photoRef.current?.click()}>
                  Choose a photo of one spine
                </Button>
              </div>
            ) : (
              <>
                {photoFor && !cropping && (
                  <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-[#fbf6ea] border border-[#c69a3d]/25 px-3.5 py-2.5">
                    <p className="basis-full sm:basis-0 sm:flex-1 min-w-0 text-sm leading-6 text-[#5b4718]">
                      <span className="font-semibold">Spine photo</span> for{" "}
                      <span className="font-medium">{photoTitle(photoFor)}</span>: line the spine up in the frame and tap the camera.
                    </p>
                    <span className="flex gap-1.5 ml-auto">
                      <Button variant="ghost" size="sm" onClick={() => choosePhoto(photoFor)}>
                        Choose photo
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setPhotoFor(null)}>
                        {photoFor === "proposal" && !proposal?.ownPhoto ? "Use auto photo" : "Cancel"}
                      </Button>
                    </span>
                  </div>
                )}

                {cropping && (
                  <SpineCropper
                    picture={cropping.picture}
                    initial={cropping.rect}
                    title={photoTitle(cropping.target)}
                    onUse={applyCrop}
                    onRetake={() => startPhoto(cropping.target)}
                    onCancel={() => setCropping(null)}
                  />
                )}

                {/* Kept mounted while cropping so the camera doesn't restart */}
                <div className={cropping ? "hidden" : ""}>
                  <SpineViewfinder
                    paused={!!proposal || readerState !== "ready" || saving || !!cropping}
                    photoMode={!!photoFor}
                    onCapture={onCapture}
                    status={status}
                    tone={tone}
                    onRead={handleRead}
                    onCameraError={setCameraError}
                  />
                </div>
                {!photoFor && !cropping && (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => photoRef.current?.click()}
                      className={`text-xs font-medium text-slate-500 underline underline-offset-4 decoration-slate-300 hover:text-[#0f172a] rounded ${focusRing}`}
                    >
                      Or use a photo of one spine
                    </button>
                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                      <input type="checkbox" checked={askPhoto} onChange={(e) => changeAskPhoto(e.target.checked)} className="w-4 h-4 accent-[#7a947c]" />
                      Take my own spine photo after each match
                    </label>
                  </div>
                )}
              </>
            )}

            {/* ---------- Confirm the match ---------- */}
            {proposal && (
              <section
                aria-labelledby="proposal-title"
                className={`rounded-2xl border p-3.5 sm:p-4 ${proposal.bookId ? "border-[#7a947c]/40 bg-[#f4f8f4]" : "border-[#e8cbc4] bg-[#fdf5f3]"}`}
              >
                <div className="flex gap-3.5">
                  <div className="shrink-0 flex flex-col items-center gap-1">
                    <div className="w-11 h-28 rounded-md overflow-hidden ring-1 ring-[#0f172a]/10 bg-[#e9e4d9] flex items-center justify-center">
                      <img src={proposal.shot.thumb} alt="The spine photo that will be used" className="max-w-full max-h-full object-contain" />
                    </div>
                    <span className={`text-[10px] font-semibold uppercase tracking-wide ${proposal.ownPhoto ? "text-[#4a5c4b]" : "text-slate-400"}`}>
                      {proposal.ownPhoto ? "Your photo" : "Auto"}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    {proposedBook ? (
                      <>
                        <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
                          <span className="text-[#2f4a31] bg-[#dfeadf] rounded-full px-2 py-0.5">✓ In your library</span>
                          {proposedLevel === "maybe" && <span className="text-[#8a6a22] bg-[#fbf3e2] rounded-full px-2 py-0.5">Check it&apos;s right</span>}
                        </p>
                        <h3 id="proposal-title" className="mt-1.5 font-classical text-lg font-semibold text-[#0f172a] leading-snug line-clamp-2">{proposedBook.title}</h3>
                        {proposedBook.author && <p className="text-sm text-slate-500 truncate">{proposedBook.author}</p>}
                        {duplicateAt >= 0 && <p className="mt-1.5 text-xs text-[#a14e43]">Already added as book {duplicateAt + 1} on this shelf.</p>}
                        {duplicateAt < 0 && movesFrom && <p className="mt-1.5 text-xs text-[#8a6a22]">Currently on {movesFrom}; it will move here.</p>}
                      </>
                    ) : (
                      <>
                        <h3 id="proposal-title" className="font-classical text-lg font-semibold text-[#0f172a]">Not found in your library</h3>
                        <p className="text-sm text-slate-500 mt-0.5 leading-6">
                          {proposal.text ? <>We read &ldquo;{proposal.text.slice(0, 60)}&rdquo;. </> : "We couldn't read this spine. "}
                          Search for it below, or{" "}
                          <Link href="/library" target="_blank" rel="noopener" className="underline underline-offset-4 text-[#4a5c4b]">
                            add it to your library
                          </Link>{" "}
                          first.
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {/* The spine photo to keep */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-slate-500 mr-1">Spine photo:</span>
                  <Button variant={proposal.ownPhoto ? "outline" : "dark"} size="sm" onClick={() => startPhoto("proposal")} disabled={photoFor === "proposal" && !cropping}>
                    {proposal.ownPhoto ? "Retake" : "Take photo"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => adjustPhoto("proposal")}>
                    Adjust crop
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => choosePhoto("proposal")}>
                    Choose photo
                  </Button>
                </div>

                {/* Other close matches */}
                {proposal.candidates.filter((c) => c.bookId !== proposal.bookId).length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs text-slate-500 mb-1.5">{proposal.bookId ? "Not this one? Did you mean:" : "Close matches:"}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {proposal.candidates
                        .filter((c) => c.bookId !== proposal.bookId)
                        .slice(0, 4)
                        .map((c) => (
                          <button
                            key={c.bookId}
                            type="button"
                            onClick={() => setProposal({ ...proposal, bookId: c.bookId })}
                            className={`max-w-full truncate h-8 px-3 rounded-full bg-white border border-[#0f172a]/10 text-xs text-slate-700 hover:border-[#7a947c] ${focusRing}`}
                          >
                            {bookMap.get(c.bookId)?.title}
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                {/* Search the library */}
                <div className="mt-3">
                  <label htmlFor="spine-search" className="sr-only">Search your library</label>
                  <input
                    id="spine-search"
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search your library by title or author"
                    className="w-full h-11 px-4 rounded-full bg-white border border-[#0f172a]/10 text-base sm:text-sm placeholder:text-slate-400 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10"
                  />
                  {search.trim() && (
                    <ul className="mt-2 rounded-xl bg-white border border-[#0f172a]/10 divide-y divide-[#0f172a]/[0.05] overflow-hidden">
                      {searchResults.length === 0 ? (
                        <li className="px-3.5 py-3 text-sm text-slate-500">
                          Not in your library.{" "}
                          <Link href="/library" target="_blank" rel="noopener" className="underline underline-offset-4 text-[#4a5c4b]">
                            Add it first
                          </Link>
                        </li>
                      ) : (
                        searchResults.map((b) => (
                          <li key={b.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setProposal({ ...proposal, bookId: b.id });
                                setSearch("");
                              }}
                              className={`w-full text-left px-3.5 py-2.5 hover:bg-[#f3eee3] ${focusRing}`}
                            >
                              <span className="block text-sm font-medium text-[#0f172a] truncate">{b.title}</span>
                              {b.author && <span className="block text-xs text-slate-500 truncate">{b.author}</span>}
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={clearProposal}>
                    Scan again
                  </Button>
                  <Button onClick={confirm} disabled={!proposal.bookId || duplicateAt >= 0}>
                    Add to shelf
                  </Button>
                </div>
              </section>
            )}

            {/* ---------- This shelf so far ---------- */}
            <section aria-labelledby="captured-title">
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <h3 id="captured-title" className="font-classical text-lg font-semibold text-[#0f172a]">
                  This shelf, left to right
                </h3>
                <span className="text-xs text-slate-500">{captured.length} {captured.length === 1 ? "book" : "books"}</span>
              </div>

              {captured.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-[#0f172a]/12 bg-white/60 px-4 py-5 text-sm text-slate-500 text-center">
                  Books you add appear here in order.
                </p>
              ) : (
                <ol className="space-y-2">
                  {captured.map((c, i) => {
                    const book = bookMap.get(c.bookId);
                    return (
                      <li key={c.key} className="rounded-2xl bg-white/80 border border-[#0f172a]/[0.07] p-2 pr-2.5">
                        <div className="flex items-center gap-3">
                        <span className="w-6 text-center text-xs font-semibold text-slate-400 tabular-nums">{i + 1}</span>
                        <button
                          type="button"
                          onClick={() => setExpanded((k) => (k === c.key ? null : c.key))}
                          aria-expanded={expanded === c.key}
                          aria-label={`Spine photo for ${book?.title}: retake or adjust`}
                          className={`relative shrink-0 rounded-sm ${focusRing}`}
                        >
                          <img src={c.shot.thumb} alt="" className="w-6 h-14 rounded-sm object-cover ring-1 ring-[#0f172a]/10" />
                          <span aria-hidden="true" className="absolute -bottom-1 -right-1.5 w-4 h-4 rounded-full bg-[#0f172a] text-[#fdfaf3] flex items-center justify-center">
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M4 7h3l2-3h6l2 3h3v12H4z" />
                            </svg>
                          </span>
                        </button>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-[#0f172a] truncate">{book?.title}</span>
                          {book?.author && <span className="block text-xs text-slate-500 truncate">{book.author}</span>}
                        </span>
                        <span className="flex items-center gap-0.5 shrink-0">
                          <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${book?.title} left`} className={`w-9 h-9 rounded-full text-slate-500 hover:bg-[#0f172a]/5 disabled:opacity-25 ${focusRing}`}>
                            ↑
                          </button>
                          <button type="button" onClick={() => move(i, 1)} disabled={i === captured.length - 1} aria-label={`Move ${book?.title} right`} className={`w-9 h-9 rounded-full text-slate-500 hover:bg-[#0f172a]/5 disabled:opacity-25 ${focusRing}`}>
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => setCaptured((cur) => cur.filter((x) => x.key !== c.key))}
                            aria-label={`Remove ${book?.title}`}
                            className={`w-9 h-9 rounded-full text-slate-400 hover:text-[#a14e43] hover:bg-[#f7e9e6] ${focusRing}`}
                          >
                            ×
                          </button>
                        </span>
                        </div>
                        {expanded === c.key && (
                          <div className="mt-2 ml-9 flex flex-wrap items-center gap-1.5">
                            <span className="text-xs text-slate-500 mr-1">{c.ownPhoto ? "Your photo" : "Auto photo"}:</span>
                            <Button variant="outline" size="sm" onClick={() => startPhoto(c.key)}>
                              Retake
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => adjustPhoto(c.key)}>
                              Adjust crop
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => choosePhoto(c.key)}>
                              Choose photo
                            </Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-5 px-4 py-3 rounded-xl bg-[#fbefed] border border-red-200/70 text-[#a14e43] text-sm">
            {error}
          </p>
        )}
      </div>

      <div className="px-5 sm:px-8 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:py-5 border-t border-[#0f172a]/[0.06] flex flex-col-reverse sm:flex-row sm:items-center gap-2.5">
        {step === "setup" ? (
          <>
            <Button variant="outline" onClick={close} className="sm:ml-auto">Cancel</Button>
            <Button variant="dark" onClick={startScanning} disabled={!shelfId}>
              Start scanning
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep("setup")} disabled={saving} className="sm:mr-auto">
              ← Change shelf
            </Button>
            <Button onClick={save} loading={saving} disabled={captured.length === 0 || !!proposal}>
              {saving ? "Saving shelf…" : `Save ${captured.length} ${captured.length === 1 ? "book" : "books"}`}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
