"use client";

import { useActionState, useId, useState, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import type { SignerActionResult } from "@/app/c/_lib/result";
import { Notice } from "./notice";
import { DISABLED_ACTION, FOCUS_RING, PRIMARY_ACTION, TINY } from "./styles";

const NO_SUBSCRIPTION = () => () => {};

function SubmitButton({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus();
  const disabled = blocked || pending;
  return (
    <button
      type="submit"
      className={disabled ? DISABLED_ACTION : PRIMARY_ACTION}
      disabled={disabled}
    >
      {pending ? "Aceptando…" : "Aceptar contrato"}
    </button>
  );
}

export function AcceptForm({
  action,
  legend,
}: {
  action: (
    previous: SignerActionResult,
    formData: FormData
  ) => Promise<SignerActionResult>;
  legend: ReactNode;
}) {
  const [state, formAction] = useActionState<SignerActionResult, FormData>(
    action,
    { ok: true }
  );
  const [checked, setChecked] = useState(false);
  const checkboxId = useId();

  // Sin JavaScript el botón queda utilizable y el servidor valida la casilla.
  const hydrated = useSyncExternalStore(
    NO_SUBSCRIPTION,
    () => true,
    () => false
  );

  return (
    <form action={formAction} className="space-y-6">
      {legend}

      <label
        htmlFor={checkboxId}
        className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#D6D3D1] bg-[#FAFAF9] p-4"
      >
        <input
          id={checkboxId}
          name="aceptacion"
          type="checkbox"
          value="si"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
          className={`mt-0.5 h-6 w-6 shrink-0 cursor-pointer accent-[#CA8A04] ${FOCUS_RING}`}
        />
        <span className="text-base leading-relaxed text-[#1C1917]">
          Manifiesto mi conformidad con la leyenda anterior y con el texto de
          este contrato.
        </span>
      </label>

      {state.ok === false ? (
        <Notice tone="warning" role="alert">
          {state.error}
        </Notice>
      ) : null}

      <SubmitButton blocked={hydrated && !checked} />

      <p className={TINY}>
        Al aceptar no se crea una cuenta, una bandeja o un seguimiento para ti.
      </p>
    </form>
  );
}
