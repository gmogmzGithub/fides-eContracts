"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import {
  buttonClass,
  type ButtonSize,
  type ButtonVariant,
} from "@/components/ui/button-styles";

export interface SubmitButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children"> {
  children: ReactNode;
  /** Fuerza el estado de espera; si se omite se toma de `useFormStatus`. */
  pending?: boolean;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function SubmitButton({
  children,
  pending,
  pendingLabel = "Guardando…",
  variant = "primary",
  size = "md",
  className,
  disabled,
  ...rest
}: SubmitButtonProps) {
  const status = useFormStatus();
  const waiting = pending ?? status.pending;
  return (
    <button
      type="submit"
      aria-busy={waiting || undefined}
      disabled={waiting || disabled}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {waiting ? pendingLabel : children}
    </button>
  );
}
