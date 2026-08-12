"use client";

import { useActionState, type ReactNode } from "react";
import { SubmitButton } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import type { ButtonVariant } from "@/components/ui/button-styles";
import { IDLE_STATE, type ActionState } from "@/app/app/_lib/action-result";

export type PortalAction = (
  state: ActionState,
  data: FormData
) => Promise<ActionState>;

/**
 * Formulario genérico del portal: toda Server Action regresa
 * `{ ok: false, error }` y el mensaje se muestra junto al botón.
 */
export function ActionForm({
  action,
  submitLabel,
  variant = "primary",
  size = "md",
  className,
  hidden,
  children,
  footer,
}: {
  action: PortalAction;
  submitLabel: string;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  className?: string;
  hidden?: Record<string, string | number | boolean>;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const [state, formAction] = useActionState(action, IDLE_STATE);
  return (
    <form action={formAction} className={className ?? "grid gap-4"}>
      {hidden
        ? Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={String(value)} />
          ))
        : null}
      {children}
      <FormMessage state={state} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant={variant} size={size}>
          {submitLabel}
        </SubmitButton>
        {footer}
      </div>
    </form>
  );
}
