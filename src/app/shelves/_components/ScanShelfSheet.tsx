// src/app/shelves/_components/ScanShelfSheet.tsx
// Scan one real shelf:
//   1. Photo     choose the shelf it belongs to and take a photo
//   2. Spines    check the detected lines between books (move, add, remove, skip)
//   3. Match     each spine is read and matched to a book in your library; fix any
//   4. Save      spine strips upload (full photo stays on your device), shelf saves in order
// Everything up to saving happens in the browser.

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Modal, { ModalHeader } from "../../components/ui/Modal";
import Button, { focusRing } from "../../components/ui/Button";
import { supabase } from "../../../lib/supabase";
import { SPINE_BUCKET, type Bookcase, type Layout, type Shelf, type ShelfBook } from "../_lib/shelves";
import { detectSpineEdges, loadScanImage, makeSpineCrops, type ScanImage, type SpineCrop } from "../_lib/spineDetect";
import { readSpines } from "../_lib/ocr";
import { assignBooks, matchLevel, type MatchCandidate } from "../_lib/match";
import DividerEditor from "./DividerEditor";

type Step = "photo" | "spines" | "match";

interface Row {
  crop: SpineCrop;
  text: string;
  candidates: MatchCandidate[];
  bookId: string; // "" = skip
}

const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

const selectClass = `w-full h-11 pl-3.5 pr-9 rounded-xl bg-white border border-[#0f172a]/10 text-base sm:text-sm text-slate-700 appearance-none bg-no-repeat bg-[right_0.8rem_center] bg-[url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>")] focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10`;

const STEPS: { id: Step; label: string }[] = [
  { id: "photo", label: "Photo" },
  { id: "spines", label: "Spines" },
  { id: "match", label: "Match" },
];

async function uploadAll(userId: string, rows: Row[]) {
  const paths = new Map<number, string>();
  const queue = [...rows];
  const worker = async () => {
    while (queue.length) {
      const row = queue.shift()!;
      if (!row.crop.blob) continue;
      const path = `${userId}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage
        .from(SPINE_BUCKET)
        .upload(path, row.crop.blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
      if (error) throw error;
      paths.set(row.crop.index, path);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
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
  const [step, setStep] = useState<Step>("photo");
  const [caseId, setCaseId] = useState("");
  const [shelfId, setShelfId] = useState("");
  const [replace, setReplace] = useState(true);

  const [image, setImage] = useState<ScanImage | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [edges, setEdges] = useState<number[]>([]);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [sensitivity, setSensitivity] = useState(0.5);

  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState<"" | "loading" | "reading" | "saving">("");
  const [error, setError] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const bookMap = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);
  const sortedBooks = useMemo(() => [...books].sort((a, b) => a.title.localeCompare(b.title)), [books]);

  const shelvesByCase = useMemo(() => {
    const map = new Map<string, Shelf[]>();
    shelves.forEach((s) => map.set(s.bookcase_id, [...(map.get(s.bookcase_id) ?? []), s]));
    map.forEach((l) => l.sort((a, b) => a.position - b.position));
    return map;
  }, [shelves]);

  // Where each book is now, to warn before moving it
  const shelfOf = useMemo(() => {
    const m = new Map<string, string>();
    Object.entries(layout).forEach(([sid, ids]) => ids.forEach((id) => m.set(id, sid)));
    return m;
  }, [layout]);

  function shelfName(sid: string) {
    const s = shelves.find((x) => x.id === sid);
    if (!s) return "";
    const c = bookcases.find((x) => x.id === s.bookcase_id);
    return `${c?.name ?? "Bookcase"} · ${s.label || `Shelf ${s.position + 1}`}`;
  }

  // ---------- Reset when opened ----------
  useEffect(() => {
    if (!open) return;
    const start = shelves.find((s) => s.id === initialShelfId) ?? shelves[0];
    setCaseId(start?.bookcase_id ?? "");
    setShelfId(start?.id ?? "");
    setStep("photo");
    setReplace(true);
    setImage(null);
    setEdges([]);
    setSkipped(new Set());
    setRows([]);
    setProgress(null);
    setError("");
    setBusy("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function close() {
    if (busy === "saving") return;
    abortRef.current?.abort();
    onClose();
  }

  // ---------- 1. Photo ----------
  async function onPhoto(file: File | undefined) {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Choose a photo (JPG, PNG or HEIC from your camera).");
    if (file.size > MAX_PHOTO_BYTES) return setError("That photo is over 25 MB. Try a smaller one.");

    setBusy("loading");
    try {
      const img = await loadScanImage(file);
      setImage(img);
      setImageUrl(URL.createObjectURL(file));
      setEdges(detectSpineEdges(img, sensitivity));
      setSkipped(new Set());
      setStep("spines");
    } catch (err) {
      console.error("Photo load failed:", err);
      setError("That photo couldn't be opened. Try a JPG or PNG.");
    } finally {
      setBusy("");
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function redetect(value: number) {
    setSensitivity(value);
    if (image) {
      setEdges(detectSpineEdges(image, value));
      setSkipped(new Set());
    }
  }

  function toggleSkip(i: number) {
    setSkipped((cur) => {
      const next = new Set(cur);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  // ---------- 2 → 3. Read and match ----------
  async function readAndMatch(useOcr: boolean) {
    if (!image) return;
    setError("");
    setBusy("reading");
    setProgress(null);

    try {
      const crops = await makeSpineCrops(image, edges, skipped);
      if (crops.length === 0) {
        setError("There are no spines to read. Add a divider or include a skipped gap.");
        return;
      }

      let texts = crops.map((c) => ({ index: c.index, text: "" }));
      if (useOcr) {
        abortRef.current = new AbortController();
        setProgress({ done: 0, total: crops.length });
        const read = await readSpines(crops, (done, total) => setProgress({ done, total }), abortRef.current.signal);
        texts = crops.map((c) => ({ index: c.index, text: read.find((r) => r.index === c.index)?.text ?? "" }));
      }

      const { assigned, ranked } = assignBooks(texts, books);
      setRows(
        crops.map((crop) => ({
          crop,
          text: texts.find((t) => t.index === crop.index)?.text ?? "",
          candidates: ranked.get(crop.index) ?? [],
          bookId: assigned.get(crop.index)?.bookId ?? "",
        }))
      );
      setStep("match");
    } catch (err) {
      console.error("Reading spines failed:", err);
      setError("The spines couldn't be read. You can still match them yourself.");
    } finally {
      setBusy("");
      setProgress(null);
    }
  }

  function setRowBook(index: number, bookId: string) {
    setRows((cur) =>
      cur.map((r) => {
        if (r.crop.index === index) return { ...r, bookId };
        if (bookId && r.bookId === bookId) return { ...r, bookId: "" }; // a book can only be in one spot
        return r;
      })
    );
  }

  // ---------- 4. Save ----------
  async function save() {
    const chosen = rows.filter((r) => r.bookId);
    if (!shelfId || chosen.length === 0) return setError("Match at least one spine to a book.");

    setBusy("saving");
    setError("");
    let uploaded = new Map<number, string>();

    try {
      uploaded = await uploadAll(userId, chosen);

      const items = chosen.map((r) => ({
        book_id: r.bookId,
        spine_color: r.crop.color,
        spine_path: uploaded.get(r.crop.index) ?? null,
        spine_ratio: Number(r.crop.ratio.toFixed(4)),
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

      onSaved(shelfId, chosen[0]?.bookId ?? null, chosen.length);
    } catch (err) {
      console.error("Saving the scan failed:", err);
      const paths = Array.from(uploaded.values());
      if (paths.length) await supabase.storage.from(SPINE_BUCKET).remove(paths);
      const e = err as { code?: string; message?: string };
      setError(
        e?.code === "PGRST202" || e?.message?.toLowerCase().includes("bucket")
          ? "The shelves database isn't set up yet. Run shelves.sql in Supabase."
          : "The shelf couldn't be saved. Try again."
      );
    } finally {
      setBusy("");
    }
  }

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const included = edges.length + 1 - skipped.size;
  const matched = rows.filter((r) => r.bookId).length;

  return (
    <Modal open={open} onClose={close} labelledBy="scan-title" size="lg" dismissible={busy !== "saving"}>
      {/* Header + steps */}
      <div className="px-5 sm:px-8 pt-3 sm:pt-7 pb-4 border-b border-[#0f172a]/[0.06]">
        <div className="sm:hidden mx-auto mb-4 h-1 w-10 rounded-full bg-[#0f172a]/15" aria-hidden="true" />
        <ModalHeader
          id="scan-title"
          title="Scan a shelf"
          description="Photograph one shelf straight on. Your photo stays on this device."
          onClose={close}
          disabled={busy === "saving"}
        />
        <ol className="mt-4 grid grid-cols-3 gap-2" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.id} aria-current={i === stepIndex ? "step" : undefined}>
              <span className={`block h-1 rounded-full transition-colors ${i <= stepIndex ? "bg-[#7a947c]" : "bg-[#0f172a]/10"}`} />
              <span className={`mt-1.5 block text-xs ${i === stepIndex ? "font-semibold text-[#0f172a]" : "text-slate-400"}`}>
                {i + 1}. {s.label}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-5 sm:px-8 py-6">
        {/* ---------- 1. Photo ---------- */}
        {step === "photo" && (
          <div className="space-y-6">
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

            <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-slate-600">
              {["One shelf per photo, left edge to right edge", "Stand square to the shelf, not at an angle", "Good, even light; no flash glare"].map((tip) => (
                <li key={tip} className="flex gap-2 rounded-xl bg-[#f3eee3] px-3 py-2.5">
                  <span aria-hidden="true" className="text-[#7a947c]">✓</span>
                  {tip}
                </li>
              ))}
            </ul>

            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} onChange={(e) => onPhoto(e.target.files?.[0])} />
            <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => onPhoto(e.target.files?.[0])} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                disabled={!shelfId || busy === "loading"}
                className={`flex flex-col items-center justify-center gap-2 min-h-[150px] rounded-2xl bg-[#0f172a] text-[#fdfaf3] hover:bg-[#1e293b] disabled:opacity-40 transition-colors ${focusRing}`}
              >
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 7h3l2-3h6l2 3h3v12H4z" />
                  <circle cx="12" cy="13" r="3.5" />
                </svg>
                <span className="text-sm font-medium">{busy === "loading" ? "Opening photo…" : "Take a photo"}</span>
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={!shelfId || busy === "loading"}
                className={`flex flex-col items-center justify-center gap-2 min-h-[150px] rounded-2xl border-2 border-dashed border-[#0f172a]/15 bg-white text-slate-600 hover:border-[#7a947c] hover:bg-[#7a947c]/5 disabled:opacity-40 transition-colors ${focusRing}`}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 16V4M7 9l5-5 5 5" />
                  <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
                </svg>
                <span className="text-sm font-medium">Choose a photo</span>
              </button>
            </div>

            <fieldset>
              <legend className="block text-xs font-medium text-slate-500 mb-2">Books already on this shelf</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { value: true, label: "Replace them", hint: "The shelf will match your photo" },
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

        {/* ---------- 2. Spines ---------- */}
        {step === "spines" && image && imageUrl && (
          <div className="space-y-5">
            <p className="text-sm text-slate-600 leading-6">
              We found <span className="font-semibold text-[#0f172a]">{included}</span> {included === 1 ? "spine" : "spines"}. Drag a gold line to move it, tap
              the photo to add one, or tap a number to skip something that isn&apos;t a book.
            </p>

            <DividerEditor
              src={imageUrl}
              width={image.width}
              height={image.height}
              edges={edges}
              skipped={skipped}
              onEdgesChange={(next) => {
                // Adding or removing a line renumbers the gaps, so skips start over
                if (next.length !== edges.length) setSkipped(new Set());
                setEdges(next);
              }}
              onToggleSkip={toggleSkip}
            />

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <label htmlFor="sensitivity" className="text-xs font-medium text-slate-500 shrink-0">Detection</label>
              <div className="flex items-center gap-3 flex-1">
                <span className="text-xs text-slate-400">Fewer</span>
                <input
                  id="sensitivity"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={sensitivity}
                  onChange={(e) => redetect(Number(e.target.value))}
                  className="flex-1 accent-[#7a947c]"
                />
                <span className="text-xs text-slate-400">More</span>
              </div>
            </div>

            {busy === "reading" && progress && (
              <div role="status" className="rounded-2xl bg-[#f3eee3] px-4 py-3">
                <div className="flex justify-between text-xs text-slate-600 mb-2">
                  <span>Reading spines…</span>
                  <span className="tabular-nums">{progress.done} of {progress.total}</span>
                </div>
                <div className="h-1.5 rounded-full bg-[#0f172a]/10 overflow-hidden">
                  <div className="h-full bg-[#7a947c] transition-[width] duration-300" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---------- 3. Match ---------- */}
        {step === "match" && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600 leading-6">
              Left to right, as on your shelf. <span className="font-semibold text-[#0f172a]">{matched}</span> of {rows.length} matched. Check each one, then save.
            </p>

            <ol className="space-y-2.5">
              {rows.map((row, i) => {
                const level = row.bookId ? matchLevel(row.candidates.find((c) => c.bookId === row.bookId)?.score ?? 0) : "none";
                const current = row.bookId ? shelfOf.get(row.bookId) : undefined;
                const movingFrom = current && current !== shelfId && current !== "tray" ? shelfName(current) : "";
                const best = new Set(row.candidates.map((c) => c.bookId));

                return (
                  <li key={row.crop.index} className="flex gap-3 rounded-2xl bg-white/80 border border-[#0f172a]/[0.07] p-2.5 sm:p-3">
                    <div className="w-9 sm:w-10 shrink-0 h-24 rounded-md overflow-hidden ring-1 ring-[#0f172a]/10 bg-[#e9e4d9] flex items-center justify-center">
                      <img src={row.crop.thumb} alt={`Spine ${i + 1}`} className="max-w-full max-h-full object-contain" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
                        <span className="text-xs font-semibold text-slate-500">Spine {i + 1}</span>
                        {row.bookId && level === "likely" && <span className="text-[10px] font-semibold uppercase tracking-wide text-[#4a5c4b] bg-[#eef3ee] rounded-full px-2 py-0.5">Good match</span>}
                        {row.bookId && level === "maybe" && <span className="text-[10px] font-semibold uppercase tracking-wide text-[#8a6a22] bg-[#fbf3e2] rounded-full px-2 py-0.5">Check this</span>}
                        {!row.bookId && <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-[#0f172a]/[0.05] rounded-full px-2 py-0.5">Not matched</span>}
                      </div>
                      {row.text && <p className="text-xs text-slate-400 italic truncate mb-2" title={row.text}>Read: &ldquo;{row.text}&rdquo;</p>}

                      <label className="sr-only" htmlFor={`spine-book-${row.crop.index}`}>Book for spine {i + 1}</label>
                      <select
                        id={`spine-book-${row.crop.index}`}
                        value={row.bookId}
                        onChange={(e) => setRowBook(row.crop.index, e.target.value)}
                        className={selectClass}
                      >
                        <option value="">Skip this spine</option>
                        {row.candidates.length > 0 && (
                          <optgroup label="Best matches">
                            {row.candidates.map((c) => (
                              <option key={c.bookId} value={c.bookId}>{bookMap.get(c.bookId)?.title}</option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label="All books">
                          {sortedBooks
                            .filter((b) => !best.has(b.id))
                            .map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.title}{b.author ? ` (${b.author})` : ""}
                              </option>
                            ))}
                        </optgroup>
                      </select>

                      {movingFrom && <p className="mt-1.5 text-xs text-[#8a6a22]">Moves here from {movingFrom}.</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-5 px-4 py-3 rounded-xl bg-[#fbefed] border border-red-200/70 text-[#a14e43] text-sm">
            {error}
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 sm:px-8 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:py-5 border-t border-[#0f172a]/[0.06] flex flex-col-reverse sm:flex-row sm:items-center gap-2.5">
        {step === "photo" && (
          <Button variant="outline" onClick={close} className="sm:ml-auto">Cancel</Button>
        )}

        {step === "spines" && (
          <>
            <Button variant="ghost" onClick={() => setStep("photo")} disabled={busy === "reading"} className="sm:mr-auto">
              ← New photo
            </Button>
            <Button variant="outline" onClick={() => readAndMatch(false)} disabled={busy === "reading" || included < 1}>
              I&apos;ll match them myself
            </Button>
            <Button onClick={() => readAndMatch(true)} loading={busy === "reading"} disabled={included < 1}>
              {busy === "reading" ? "Reading…" : `Read ${included} ${included === 1 ? "spine" : "spines"}`}
            </Button>
          </>
        )}

        {step === "match" && (
          <>
            <Button variant="ghost" onClick={() => setStep("spines")} disabled={busy === "saving"} className="sm:mr-auto">
              ← Adjust spines
            </Button>
            <Button onClick={save} loading={busy === "saving"} disabled={matched === 0}>
              {busy === "saving" ? "Saving shelf…" : `Save ${matched} ${matched === 1 ? "book" : "books"} to shelf`}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
