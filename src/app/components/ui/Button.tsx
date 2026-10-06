// src/app/components/ui/Button.tsx
// Pill buttons in The Archive style: sage, navy, outline, ghost, danger.

import { ButtonHTMLAttributes } from "react";
import Spinner from "./Spinner";

type Variant = "primary" | "dark" | "outline" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-[#7a947c] text-white hover:bg-[#6b826c] shadow-[0_8px_20px_rgba(122,148,124,0.25)]",
  dark: "bg-[#0f172a] text-[#fdfaf3] hover:bg-[#1e293b] shadow-md hover:shadow-lg",
  outline:
    "bg-white/70 text-slate-700 border border-[#0f172a]/10 hover:bg-white hover:text-[#0f172a] hover:border-[#0f172a]/25",
  ghost: "text-slate-500 hover:text-[#0f172a] hover:bg-[#0f172a]/5",
  danger: "bg-[#c0675b] text-white hover:bg-[#a14e43]",
};

const SIZES = {
  sm: "h-9 px-4 text-xs",
  md: "h-11 px-6 text-sm",
  lg: "h-12 px-7 text-sm",
};

export const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#7a947c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fdfaf3]";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: keyof typeof SIZES;
  loading?: boolean;
  fullWidth?: boolean;
}

export default function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  className = "",
  disabled,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const lightSpinner = variant === "primary" || variant === "dark" || variant === "danger";

  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all
        disabled:opacity-40 disabled:cursor-not-allowed
        ${focusRing} ${VARIANTS[variant]} ${SIZES[size]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {loading && <Spinner light={lightSpinner} />}
      {children}
    </button>
  );
}
