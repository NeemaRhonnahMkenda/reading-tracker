"use client";

// src/app/components/ui/Toast.tsx

import { useCallback, useEffect, useState } from "react";
import { focusRing } from "./Button";

export type ToastState = { type: "success" | "error"; message: string } | null;

export function useToast(duration = 3500) {
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), duration);
    return () => window.clearTimeout(timer);
  }, [toast, duration]);

  const showToast = useCallback((type: "success" | "error", message: string) => setToast({ type, message }), []);
  const dismissToast = useCallback(() => setToast(null), []);

  return { toast, showToast, dismissToast };
}

export default function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  return (
    <div
      className="fixed bottom-24 lg:bottom-6 inset-x-5 sm:inset-x-auto sm:right-6 z-[70] sm:max-w-sm"
      role="status"
      aria-live="polite"
    >
      {toast && (
        <div
          className={`flex items-center gap-3 rounded-2xl px-5 py-4 shadow-[0_15px_45px_rgba(15,23,42,0.15)] border ${
            toast.type === "success" ? "bg-white border-[#7a947c]/25" : "bg-[#fbefed] border-red-200/70"
          }`}
        >
          <span
            aria-hidden="true"
            className={`w-7 h-7 rounded-full flex items-center justify-center text-sm text-white shrink-0 ${
              toast.type === "success" ? "bg-[#7a947c]" : "bg-[#c0675b]"
            }`}
          >
            {toast.type === "success" ? "✓" : "!"}
          </span>
          <p className={`flex-1 text-sm font-medium ${toast.type === "success" ? "text-[#4a5c4b]" : "text-[#a14e43]"}`}>
            {toast.message}
          </p>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss notification"
            className={`text-slate-400 hover:text-[#0f172a] text-lg leading-none rounded ${focusRing}`}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
