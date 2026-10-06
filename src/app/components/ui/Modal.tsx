"use client";

// src/app/components/ui/Modal.tsx
// Modal / bottom sheet in The Archive style. Escape to close, focus trap,
// scroll lock, focus returns to whatever opened it.

import { ReactNode, useEffect, useRef } from "react";
import { focusRing } from "./Button";

const SIZES = {
  sm: "sm:max-w-md",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
  dismissible?: boolean;
  size?: keyof typeof SIZES;
  role?: "dialog" | "alertdialog";
}

export default function Modal({
  open,
  onClose,
  labelledBy,
  children,
  dismissible = true,
  size = "md",
  role = "dialog",
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);

  useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

  useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && dismissibleRef.current) {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key === "Tab" && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    window.addEventListener("keydown", onKey);

    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) panel.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="ui-modal-backdrop fixed inset-0 z-[60] bg-[#0f172a]/55 backdrop-blur-sm flex items-end sm:items-center justify-center sm:px-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissibleRef.current) onCloseRef.current();
      }}
    >
      <style>{`
        @keyframes ui-modal-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes ui-modal-rise { from { opacity: 0; transform: translateY(20px) } to { opacity: 1; transform: none } }
        .ui-modal-backdrop { animation: ui-modal-fade 180ms ease-out both; }
        .ui-modal-panel { animation: ui-modal-rise 300ms cubic-bezier(.2,.8,.2,1) both; }
        @media (prefers-reduced-motion: reduce) { .ui-modal-backdrop, .ui-modal-panel { animation: none; } }
      `}</style>

      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`ui-modal-panel w-full ${SIZES[size]} max-h-[94vh] flex flex-col bg-[#fdfaf3] border border-[#0f172a]/10 rounded-t-[1.6rem] sm:rounded-[1.6rem] shadow-[0_25px_80px_rgba(15,23,42,0.22)] outline-none`}
      >
        {children}
      </div>
    </div>
  );
}

// Title, optional description and a close button, matching the site's modals
export function ModalHeader({
  id,
  title,
  description,
  onClose,
  disabled = false,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 id={id} className="text-3xl font-classical font-semibold text-[#0f172a]">
          {title}
        </h2>
        {description && <p className="text-sm text-slate-500 mt-2 leading-6 font-light">{description}</p>}
      </div>
      <button
        type="button"
        onClick={onClose}
        disabled={disabled}
        aria-label="Close"
        className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-slate-400 hover:text-[#0f172a] hover:bg-[#0f172a]/5 transition-colors disabled:opacity-40 ${focusRing}`}
      >
        <span aria-hidden="true" className="text-2xl leading-none">×</span>
      </button>
    </div>
  );
}
