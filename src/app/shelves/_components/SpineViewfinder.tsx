// src/app/shelves/_components/SpineViewfinder.tsx
// Live camera with a spine-shaped guide, like the barcode scanner. Fit one
// spine inside the frame (use the slider to match its thickness) and hold
// still: the frame is read about twice a second until a book is recognised.

"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { focusRing } from "../../components/ui/Button";
import { cropFromVideo, type GuideBox } from "../_lib/spineCapture";

const GUIDE_HEIGHT = 0.86;

function guideFor(thickness: number): GuideBox {
  const w = 0.07 + thickness * 0.26; // 7% .. 33% of the viewfinder width
  return { x: (1 - w) / 2, y: (1 - GUIDE_HEIGHT) / 2, w, h: GUIDE_HEIGHT };
}

export default function SpineViewfinder({
  paused,
  status,
  tone,
  onRead,
  onCameraError,
}: {
  paused: boolean; // stop reading (e.g. while a match waits for confirmation)
  status: ReactNode;
  tone: "idle" | "reading" | "found" | "warn";
  onRead: (crop: HTMLCanvasElement, manual: boolean) => Promise<void>;
  onCameraError: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  const [ready, setReady] = useState(false);
  const [thickness, setThickness] = useState(0.3);
  const thicknessRef = useRef(thickness);
  thicknessRef.current = thickness;
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);

  // ---------- Camera ----------
  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        onCameraError("This browser can't use the camera. Use a photo of the spine instead.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setReady(true);

        const track = stream.getVideoTracks()[0];
        const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
        setTorchAvailable(!!caps.torch);
      } catch (err) {
        const name = (err as Error)?.name;
        onCameraError(
          name === "NotAllowedError"
            ? "Camera access was blocked. Allow it in your browser settings, or use a photo of the spine."
            : "The camera couldn't start. Use a photo of the spine instead."
        );
      }
    }

    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grab = useCallback(() => {
    const video = videoRef.current;
    const box = boxRef.current;
    if (!video || !box || video.readyState < 2) return null;
    return cropFromVideo(video, box.clientWidth, box.clientHeight, guideFor(thicknessRef.current));
  }, []);

  // ---------- Reading loop ----------
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    let timer = 0;

    const tick = async () => {
      if (stopped) return;
      if (!pausedRef.current && !busyRef.current && document.visibilityState === "visible") {
        const crop = grab();
        if (crop) {
          busyRef.current = true;
          try {
            await onReadRef.current(crop, false);
          } finally {
            busyRef.current = false;
          }
        }
      }
      timer = window.setTimeout(tick, 350);
    };

    timer = window.setTimeout(tick, 600);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [ready, grab]);

  async function readNow() {
    const crop = grab();
    if (!crop || busyRef.current) return;
    busyRef.current = true;
    setManualBusy(true);
    try {
      await onReadRef.current(crop, true);
    } finally {
      busyRef.current = false;
      setManualBusy(false);
    }
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] });
      setTorchOn((v) => !v);
    } catch {
      setTorchAvailable(false);
    }
  }

  const guide = guideFor(thickness);
  const frameColour = tone === "found" ? "border-[#9fd0a2]" : tone === "warn" ? "border-[#e8a090]" : "border-[#e8c873]";

  return (
    <div>
      <style>{`
        @keyframes vf-sweep { 0%, 100% { top: 6%; } 50% { top: 92%; } }
        .vf-sweep { animation: vf-sweep 2.4s ease-in-out infinite; }
        @keyframes vf-pop { 0% { transform: scale(1); } 40% { transform: scale(1.04); } 100% { transform: scale(1); } }
        .vf-pop { animation: vf-pop 420ms ease-out; }
        @media (prefers-reduced-motion: reduce) { .vf-sweep, .vf-pop { animation: none; } }
      `}</style>

      <div ref={boxRef} className="relative w-full h-[min(58vh,500px)] rounded-2xl overflow-hidden bg-[#0f172a]">
        <video ref={videoRef} muted playsInline className={`absolute inset-0 w-full h-full object-cover transition-opacity ${ready ? "opacity-100" : "opacity-0"}`} />

        {!ready && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[#fdfaf3]/80 text-sm">
            <span className="w-6 h-6 rounded-full border-2 border-white/30 border-t-white animate-spin" aria-hidden="true" />
            Starting the camera…
          </div>
        )}

        {/* Guide: everything outside it is dimmed */}
        <div
          aria-hidden="true"
          className={`absolute rounded-xl border-2 ${frameColour} shadow-[0_0_0_9999px_rgba(15,23,42,0.58)] transition-[left,width,border-color] duration-200 ${tone === "found" ? "vf-pop" : ""}`}
          style={{ left: `${guide.x * 100}%`, top: `${guide.y * 100}%`, width: `${guide.w * 100}%`, height: `${guide.h * 100}%` }}
        >
          {/* Corner brackets */}
          {["top-0 left-0 border-t-4 border-l-4 rounded-tl-xl", "top-0 right-0 border-t-4 border-r-4 rounded-tr-xl", "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-xl", "bottom-0 right-0 border-b-4 border-r-4 rounded-br-xl"].map((c) => (
            <span key={c} className={`absolute w-5 h-5 -m-[3px] ${c} ${frameColour}`} />
          ))}
          {!paused && ready && <span className="vf-sweep absolute left-1 right-1 h-0.5 bg-[#e8c873] shadow-[0_0_12px_#e8c873]" />}
        </div>

        {/* Status */}
        <div className="absolute top-3 inset-x-3 flex justify-center pointer-events-none">
          <span
            role="status"
            aria-live="polite"
            className={`max-w-full truncate rounded-full px-4 py-2 text-xs font-medium shadow ${
              tone === "found" ? "bg-[#eef3ee] text-[#2f4a31]" : tone === "warn" ? "bg-[#fbefed] text-[#a14e43]" : "bg-[#0f172a]/85 text-[#fdfaf3]"
            }`}
          >
            {status}
          </span>
        </div>

        {/* Controls on the picture */}
        <div className="absolute bottom-3 inset-x-3 flex items-center justify-between gap-2">
          {torchAvailable ? (
            <button
              type="button"
              onClick={toggleTorch}
              aria-pressed={torchOn}
              aria-label={torchOn ? "Turn torch off" : "Turn torch on"}
              className={`w-11 h-11 rounded-full flex items-center justify-center ${torchOn ? "bg-[#e8c873] text-[#0f172a]" : "bg-[#0f172a]/75 text-white"} ${focusRing}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 2h8l-1 6H9z" />
                <path d="M9 8v6l-1 8h8l-1-8V8" />
              </svg>
            </button>
          ) : (
            <span />
          )}

          <button
            type="button"
            onClick={readNow}
            disabled={!ready || paused || manualBusy}
            aria-label="Read this spine now"
            className={`w-16 h-16 rounded-full bg-[#fdfaf3] border-4 border-[#fdfaf3]/40 bg-clip-padding flex items-center justify-center shadow-lg disabled:opacity-40 ${focusRing}`}
          >
            {manualBusy ? (
              <span className="w-6 h-6 rounded-full border-2 border-[#0f172a]/20 border-t-[#0f172a] animate-spin" aria-hidden="true" />
            ) : (
              <span aria-hidden="true" className="w-11 h-11 rounded-full bg-[#0f172a]" />
            )}
          </button>

          <span className="w-11" />
        </div>
      </div>

      {/* Fit the frame to the spine */}
      <div className="mt-3 flex items-center gap-3">
        <label htmlFor="spine-thickness" className="text-xs font-medium text-slate-500 shrink-0">Spine</label>
        <span className="text-xs text-slate-400">Thin</span>
        <input
          id="spine-thickness"
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={thickness}
          onChange={(e) => setThickness(Number(e.target.value))}
          className="flex-1 accent-[#7a947c]"
        />
        <span className="text-xs text-slate-400">Thick</span>
      </div>
    </div>
  );
}
