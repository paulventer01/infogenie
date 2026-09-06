"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger";

export interface IgButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

const cls: Record<Variant, string> = {
  primary: "ig-btn ig-btn-primary",
  secondary: "ig-btn ig-btn-secondary btn-secondary",
  danger: "ig-btn ig-btn-primary",
};

/** Standard InfoGenie button — primary / secondary / danger. */
export default function IgButton({
  variant = "primary",
  className = "",
  style,
  children,
  ...rest
}: IgButtonProps) {
  return (
    <button
      type="button"
      className={`${cls[variant]} ${className}`.trim()}
      style={{
        ...(variant === "danger"
          ? { background: "linear-gradient(135deg,#EF4444,#DC2626)" }
          : undefined),
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
