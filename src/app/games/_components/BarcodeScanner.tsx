// src/app/games/_components/BarcodeScanner.tsx
// Live camera that reads the barcode on the back of a game case.
// Uses the browser's own BarcodeDetector where it exists (Chrome, Android) and
// a WebAssembly reader everywhere else (Safari, iPhone, Firefox).
// A code only counts once it has been read the same way twice in a row and its
// check digit is right, so a half-seen barcode never comes through.

"use client";

import { useEffect, useRef, useState } from "react";
import { focusRing } from "../../components/ui/Button";
import { validGtin } from "../_lib/platforms";

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };

const FORMATS = ["ean_13", "upc_a", "ean_8"];

async function makeDetector(): Promise<Detector> {
  type Native = { new (o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> };
  const native = (globalThis as unknown as { BarcodeDetector?: Native }).BarcodeDetector;
  if (native) {
    try {
      const supported = await native.getSupportedFormats();
      if (FORMATS.every((f) => supported.includes(f))) return new native({ formats: FORMATS });
    } catch {
      // fall through to the WebAssembly reader
    }
  }
  const { BarcodeDetector } = await import("barcode-detector/ponyfill");
  return new BarcodeDetector({ formats: ["ean_13", "upc_a", "ean_8"] }) as unknown as Detector;
}

// The guide: a wide band across the middle, where the barcode goes
const GUIDE = { x: 0.1, y: 0.32, w: 0.8, h: 0.36 };

export default function BarcodeScanner({
  paused,
  onDetected,
  onError,
}: {
  paused: boolean;
  onDetected: (code: string) => void;
  onError: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  const [ready, setReady] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [seen, setSeen] = useState(false); // a barcode is in view (shows the frame turning gold)

  // ---------- Camera ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        onError("This browser can't use the camera. Type the barcode numbers or search by name instead.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const track = stream.getVideoTracks()[0];
        const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
        setTorchAvailable(!!caps.torch);
        // Keep refocusing: barcodes are read close up
        if (caps.focusMode?.includes("continuous")) {
          track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
        }
        setReady(true);
      } catch (err) {
        onError(
          (err as Error)?.name === "NotAllowedError"
            ? "Camera access was blocked. Allow it in your browser settings, or type the barcode numbers."
            : "The camera couldn't start. Type the barcode numbers or search by name instead."
        );
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Reading loop ----------
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    let timer = 0;
    let detector: Detector | null = null;
    let last = { code: "", at: 0 };
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    // The part of the video under the guide (the video is drawn object-cover)
    function grab() {
      const video = videoRef.current;
      const box = boxRef.current;
      if (!video || !box || video.readyState < 2 || !video.videoWidth) return null;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const scale = Math.max(box.clientWidth / vw, box.clientHeight / vh);
      const offX = (vw * scale - box.clientWidth) / 2;
      const offY = (vh * scale - box.clientHeight) / 2;
      // A little wider than the guide, so codes at its edge still read
      const gx = Math.max(0, GUIDE.x - 0.08) * box.clientWidth;
      const gy = Math.max(0, GUIDE.y - 0.08) * box.clientHeight;
      const gw = Math.min(1, GUIDE.w + 0.16) * box.clientWidth;
      const gh = Math.min(1, GUIDE.h + 0.16) * box.clientHeight;
      const sx = (gx + offX) / scale;
      const sy = (gy + offY) / scale;
      const sw = gw / scale;
      const sh = gh / scale;
      const k = Math.min(1, 1280 / sw);
      canvas.width = Math.round(sw * k);
      canvas.height = Math.round(sh * k);
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      return canvas;
    }

    const tick = async () => {
      if (stopped) return;
      try {
        if (!pausedRef.current && document.visibilityState === "visible") {
          detector ??= await makeDetector();
          const frame = grab();
          if (frame) {
            const found = (await detector.detect(frame))
              .map((b) => b.rawValue.replace(/\D/g, ""))
              .find((v) => validGtin(v));
            setSeen(!!found);
            if (found) {
              const now = Date.now();
              if (found === last.code && now - last.at < 1500) {
                last = { code: "", at: 0 };
                navigator.vibrate?.(30);
                onDetectedRef.current(found);
              } else {
                last = { code: found, at: now };
              }
            }
          }
        }
      } catch (err) {
        console.warn("barcode read failed", err);
      }
      timer = window.setTimeout(tick, 180);
    };
    timer = window.setTimeout(tick, 300);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [ready]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] });
      setTorchOn((t) => !t);
    } catch {
      setTorchAvailable(false);
    }
  }

  const gold = seen && !paused;

  return (
    <div ref={boxRef} className="relative w-full aspect-[4/3] sm:aspect-[16/10] overflow-hidden rounded-2xl bg-[#0f172a]">
      <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />

      {/* Dimmed surround with a clear band for the barcode */}
      <div
        aria-hidden="true"
        className={`absolute rounded-xl border-2 transition-colors duration-150 shadow-[0_0_0_9999px_rgba(15,23,42,0.55)] ${
          gold ? "border-[#e8c873]" : "border-white/80"
        }`}
        style={{ left: `${GUIDE.x * 100}%`, top: `${GUIDE.y * 100}%`, width: `${GUIDE.w * 100}%`, height: `${GUIDE.h * 100}%` }}
      >
        {!paused && ready && (
          <span className="scan-line absolute inset-x-3 h-0.5 rounded-full bg-[#e8c873] shadow-[0_0_12px_#e8c873]" />
        )}
      </div>

      <p
        aria-live="polite"
        className="absolute top-3 inset-x-3 mx-auto w-fit max-w-full rounded-full bg-[#0f172a]/80 px-3.5 py-1.5 text-center text-xs font-medium text-[#fdfaf3]"
      >
        {!ready ? "Starting the camera…" : paused ? "Paused" : gold ? "Hold still…" : "Fit the barcode inside the frame"}
      </p>

      {torchAvailable && (
        <button
          type="button"
          onClick={toggleTorch}
          aria-pressed={torchOn}
          aria-label={torchOn ? "Turn the light off" : "Turn the light on"}
          className={`absolute bottom-3 right-3 w-11 h-11 rounded-full flex items-center justify-center transition-colors ${focusRing} ${
            torchOn ? "bg-[#e8c873] text-[#0f172a]" : "bg-[#0f172a]/70 text-[#fdfaf3] hover:bg-[#0f172a]/90"
          }`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 2h8l-1 6h-6zM9 8v13h6V8" />
          </svg>
        </button>
      )}

      <style>{`
        @keyframes scan-line { 0%,100% { top: 12% } 50% { top: 85% } }
        .scan-line { animation: scan-line 1.8s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .scan-line { animation: none; top: 50%; } }
      `}</style>
    </div>
  );
}
