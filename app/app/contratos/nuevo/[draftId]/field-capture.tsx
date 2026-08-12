"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { PersonKind } from "@/lib/domain/counterparties";
import type { FieldDefinition } from "@/lib/domain/templates";
import {
  Checkbox,
  Field,
  Select,
  SuggestInput,
  TextArea,
  TextInput,
  type SelectOption,
} from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { cx } from "@/components/ui/cx";
import { agregarTitularRapido, guardarCampos } from "./actions";

export interface HolderOption extends SelectOption {
  personKind: PersonKind;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: "El Borrador se guarda automáticamente.",
  saving: "Guardando…",
  saved: "Borrador guardado.",
  error: "No pudimos guardar el último cambio.",
};

const AUTOSAVE_MS = 800;
const DEFAULT_CURRENCY = "MXN";
const CURRENCY_FIELD_SUFFIX = "_moneda";
const AMOUNT_PHRASE = /\bpor\s+\d+(?:[.,]\d{1,2})?\s*(MXN|USD|EUR|CAD)?\b/iu;
const NUMBER_IN_PROGRESS = /^\d+(?:[.,]\d{0,2})?$/u;

function currencyValueKey(fieldKey: string): string {
  return `${fieldKey}${CURRENCY_FIELD_SUFFIX}`;
}

function currencyOptions(field: FieldDefinition): string[] {
  return field.options.length > 0 ? field.options : ["USD", DEFAULT_CURRENCY];
}

function initialValuesWithDefaultCurrencies(
  fields: FieldDefinition[],
  values: Record<string, string>
): Record<string, string> {
  const next = { ...values };
  for (const field of fields) {
    if (field.dataType !== "money") continue;
    const key = currencyValueKey(field.key);
    if (!next[key]) next[key] = DEFAULT_CURRENCY;
  }
  return next;
}

function phraseSuggestions(value: string, suggestions: string[]): string[] {
  const number = value.trim();
  if (!NUMBER_IN_PROGRESS.test(number)) return suggestions;
  const rewritten = suggestions
    .filter((suggestion) => AMOUNT_PHRASE.test(suggestion))
    .map((suggestion) =>
      suggestion.replace(AMOUNT_PHRASE, (_match, currency: string | undefined) =>
        `por ${number} ${currency ?? DEFAULT_CURRENCY}`
      )
    );
  return rewritten.length > 0 ? [...new Set(rewritten)] : suggestions;
}

/**
 * Captura de los Campos contractuales programados con guardado automático.
 * Sólo aparecen los campos de este Contrato-plantilla: la Organización nunca
 * edita el contenido jurídico.
 */
export function FieldCapture({
  draftId,
  fields,
  initialValues,
  holderOptions,
  signerOptions,
  initialHolderId,
  initialSignerId,
  addSignerHref,
  nextHref,
}: {
  draftId: string;
  fields: FieldDefinition[];
  initialValues: Record<string, string>;
  holderOptions: HolderOption[];
  signerOptions: SelectOption[];
  initialHolderId: string;
  initialSignerId: string;
  addSignerHref: string;
  nextHref: string;
}) {
  const router = useRouter();
  const normalizedInitialSignerId = signerOptions.some(
    (option) => option.value === initialSignerId
  )
    ? initialSignerId
    : "";
  const normalizedInitialValues = initialValuesWithDefaultCurrencies(
    fields,
    initialValues
  );
  const [values, setValues] = useState<Record<string, string>>(normalizedInitialValues);
  const [holderId, setHolderId] = useState(initialHolderId);
  const [availableHolderOptions, setAvailableHolderOptions] = useState(holderOptions);
  const [availableSignerOptions, setAvailableSignerOptions] = useState(signerOptions);
  const [signerId, setSignerId] = useState(normalizedInitialSignerId);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Record<string, string>>(normalizedInitialValues);
  const latestParties = useRef({
    holderId: initialHolderId,
    signerId: normalizedInitialSignerId,
  });

  const holder = availableHolderOptions.find((option) => option.value === holderId);
  const [sameParty, setSameParty] = useState(
    initialHolderId !== "" && initialHolderId === normalizedInitialSignerId
  );

  const missing = [
    ...(!holderId ? ["Empresa o persona titular"] : []),
    ...(!signerId ? ["Persona que aceptará"] : []),
    ...fields
      .filter((field) => field.required && !(values[field.key] ?? "").trim())
      .map((field) => field.label),
  ];

  async function flush(): Promise<boolean> {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setStatus("saving");
    const result = await guardarCampos({
      draftId,
      fieldValues: latest.current,
      holderId: latestParties.current.holderId || null,
      signerId: latestParties.current.signerId || null,
    });
    setStatus(result.ok ? "saved" : "error");
    setError(result.ok ? "" : (result.error ?? ""));
    return result.ok;
  }

  function scheduleFlush() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush();
    }, AUTOSAVE_MS);
  }

  function change(key: string, value: string) {
    const next = { ...latest.current, [key]: value };
    latest.current = next;
    setValues(next);
    scheduleFlush();
  }

  function applyParties(nextHolderId: string, nextSignerId: string) {
    latestParties.current = { holderId: nextHolderId, signerId: nextSignerId };
    setHolderId(nextHolderId);
    setSignerId(nextSignerId);
    scheduleFlush();
  }

  /**
   * Cambiar de Titular arrastra a quien acepta mientras el atajo esté activo.
   * Si el nuevo Titular es una empresa el atajo se apaga solo, para no dejar
   * asignada a una persona que ya no corresponde.
   */
  function changeHolder(value: string) {
    if (!sameParty) return applyParties(value, signerId);
    const kind = availableHolderOptions.find((option) => option.value === value)?.personKind;
    if (kind === "fisica") return applyParties(value, value);
    setSameParty(false);
    applyParties(value, "");
  }

  function toggleSameParty(checked: boolean) {
    setSameParty(checked);
    applyParties(holderId, checked ? holderId : "");
  }

  function selectCreatedHolder(created: HolderOption) {
    setAvailableHolderOptions((current) => [...current, created]);
    if (created.personKind === "fisica") {
      setAvailableSignerOptions((current) =>
        current.some((option) => option.value === created.value)
          ? current
          : [...current, { value: created.value, label: created.label }]
      );
    }

    if (sameParty && created.personKind === "fisica") {
      applyParties(created.value, created.value);
      return;
    }
    if (sameParty) setSameParty(false);
    applyParties(created.value, sameParty ? "" : signerId);
  }

  async function continueToReview() {
    if (missing.length > 0) return;
    const saved = await flush();
    if (saved) router.push(nextHref);
  }

  return (
    <div className="grid gap-5">
      {missing.length > 0 ? (
        <Alert tone="warn" title="Completa los datos obligatorios para continuar">
          <p>Falta llenar: {missing.join(", ")}.</p>
        </Alert>
      ) : null}

      <div className="grid gap-5 border-b border-line pb-5">
        <Field
          label="Empresa o persona titular"
          htmlFor="holderId"
          required
          error={!holderId ? "Selecciona quién será parte del contrato." : undefined}
        >
          <Select
            id="holderId"
            name="holderId"
            required
            invalid={!holderId}
            placeholder="Selecciona una empresa o persona"
            options={availableHolderOptions}
            value={holderId}
            onChange={(event) => changeHolder(event.target.value)}
          />
          <QuickHolderAdd
            draftId={draftId}
            onCreated={selectCreatedHolder}
          />
        </Field>

        <SamePartyChoice
          checked={sameParty}
          holder={holder}
          onChange={toggleSameParty}
        />

        <Field
          label="Persona que aceptará"
          htmlFor="signerId"
          required
          error={!signerId ? "Selecciona a la persona que aceptará." : undefined}
        >
          <Select
            id="signerId"
            name="signerId"
            required
            disabled={sameParty}
            invalid={!signerId}
            placeholder="Selecciona una persona"
            options={availableSignerOptions}
            value={signerId}
            onChange={(event) => applyParties(holderId, event.target.value)}
          />
          {sameParty ? (
            <p className="text-xs text-muted">
              Aceptará {holder?.label}. Desmarca la casilla de arriba si quieres
              elegir a otra persona.
            </p>
          ) : (
            <Link
              href={addSignerHref}
              className="w-fit cursor-pointer text-xs font-medium text-carbon-soft underline-offset-4 transition-colors duration-200 hover:text-carbon hover:underline"
            >
              Agregar a la persona que aceptará
            </Link>
          )}
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {fields.map((field) => {
          const value = values[field.key] ?? "";
          return (
            <Field
              key={field.id}
              label={field.label}
              htmlFor={`campo-${field.key}`}
              hint={field.helpText || undefined}
              required={field.required}
              className={field.dataType === "longtext" ? "sm:col-span-2" : undefined}
            >
              <FieldControl
                field={field}
                value={value}
                currencyValue={values[currencyValueKey(field.key)] ?? DEFAULT_CURRENCY}
                invalid={field.required && value.trim() === ""}
                onValue={(next) => change(field.key, next)}
                onCurrency={(next) => change(currencyValueKey(field.key), next)}
                onBlur={() => {
                  void flush();
                }}
              />
            </Field>
          );
        })}
      </div>

      {status === "error" ? (
        <Alert tone="danger">{error || STATUS_LABEL.error}</Alert>
      ) : (
        <p className="text-xs text-muted" aria-live="polite">
          {STATUS_LABEL[status]}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button onClick={continueToReview} disabled={missing.length > 0}>
          Continuar a Revisar y generar
        </Button>
      </div>
    </div>
  );
}

/** Alta deliberadamente breve: el resto de datos del contacto se puede completar después. */
function QuickHolderAdd({
  draftId,
  onCreated,
}: {
  draftId: string;
  onCreated: (holder: HolderOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [personKind, setPersonKind] = useState<PersonKind>("moral");
  const [name, setName] = useState("");
  const [rfc, setRfc] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function createHolder() {
    setSaving(true);
    setError("");
    const result = await agregarTitularRapido({ draftId, personKind, name, rfc });
    setSaving(false);
    if (!result.ok || !result.holder) {
      setError(result.error ?? "No pudimos agregar el contacto.");
      return;
    }
    onCreated({
      value: result.holder.id,
      label: result.holder.label,
      personKind: result.holder.personKind,
    });
    setName("");
    setRfc("");
    setOpen(false);
  }

  if (!open) {
    return (
      <Button type="button" variant="success" size="sm" onClick={() => setOpen(true)}>
        Agregar empresa o persona
      </Button>
    );
  }

  return (
    <div className="grid gap-3 border-l-2 border-line pl-4">
      <p className="text-sm font-medium text-carbon">Agregar contacto</p>
      <p className="text-xs text-muted">
        Se guardará en los contactos de esta organización y quedará seleccionado.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tipo" required>
          <Select
            aria-label="Tipo de titular"
            required
            value={personKind}
            options={[
              { value: "moral", label: "Empresa" },
              { value: "fisica", label: "Persona" },
            ]}
            onChange={(event) => setPersonKind(event.target.value as PersonKind)}
          />
        </Field>
        <Field label="Nombre completo o razón social" required>
          <TextInput
            aria-label="Nombre completo o razón social"
            placeholder="Nombre completo o razón social"
            value={name}
            required
            maxLength={200}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void createHolder();
              }
            }}
          />
        </Field>
        <Field label="RFC" hint="Opcional">
          <TextInput
            aria-label="RFC"
            value={rfc}
            maxLength={20}
            onChange={(event) => setRfc(event.target.value)}
          />
        </Field>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="success"
          size="sm"
          onClick={createHolder}
          disabled={saving || !name.trim()}
        >
          {saving ? "Agregando…" : "Agregar y seleccionar"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/** Un Campo programado se captura según su tipo; `suggest` propone sin cerrar. */
function FieldControl({
  field,
  value,
  currencyValue,
  invalid,
  onValue,
  onCurrency,
  onBlur,
}: {
  field: FieldDefinition;
  value: string;
  currencyValue: string;
  invalid: boolean;
  onValue: (value: string) => void;
  onCurrency: (value: string) => void;
  onBlur: () => void;
}) {
  const common = {
    id: `campo-${field.key}`,
    name: field.key,
    value,
    required: field.required,
    invalid,
    onBlur,
  };
  if (field.dataType === "longtext") {
    return <TextArea {...common} onChange={(event) => onValue(event.target.value)} />;
  }
  if (field.dataType === "select") {
    return (
      <Select
        {...common}
        placeholder="Selecciona una opción"
        options={field.options.map((option) => ({ value: option, label: option }))}
        onChange={(event) => onValue(event.target.value)}
      />
    );
  }
  if (field.dataType === "suggest") {
    const suggestions = phraseSuggestions(value, field.options);
    return (
      <div className="grid gap-2">
        <SuggestInput
          {...common}
          placeholder="Empieza a escribir…"
          suggestions={suggestions}
          onChange={(event) => onValue(event.target.value)}
        />
        {suggestions !== field.options ? (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="cursor-pointer rounded-lg border border-line bg-white px-3 py-1.5 text-left text-xs font-medium text-carbon-soft transition-colors duration-200 hover:border-carbon/40 hover:text-carbon focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                onClick={() => onValue(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  if (field.dataType === "money") {
    return (
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <TextInput
          {...common}
          type="number"
          step="0.01"
          inputMode="decimal"
          onChange={(event) => onValue(event.target.value)}
        />
        <Select
          id={`${common.id}-moneda`}
          name={currencyValueKey(field.key)}
          aria-label={`Moneda de ${field.label}`}
          value={currencyValue}
          options={currencyOptions(field).map((option) => ({
            value: option,
            label: option,
          }))}
          onChange={(event) => onCurrency(event.target.value)}
          onBlur={onBlur}
        />
      </div>
    );
  }
  const numeric = field.dataType === "number";
  return (
    <TextInput
      {...common}
      type={field.dataType === "date" ? "date" : numeric ? "number" : "text"}
      inputMode={numeric ? "decimal" : undefined}
      onChange={(event) => onValue(event.target.value)}
    />
  );
}

/**
 * Atajo para el caso más común: el Titular es quien acepta. Se presenta como
 * una casilla grande con una sola frase en lenguaje llano, porque quien captura
 * puede no estar familiarizado con formularios. Una empresa no puede aceptar
 * por sí misma: siempre comparece una persona física por ella.
 */
function SamePartyChoice({
  checked,
  holder,
  onChange,
}: {
  checked: boolean;
  holder: HolderOption | undefined;
  onChange: (checked: boolean) => void;
}) {
  const enabled = holder?.personKind === "fisica";
  return (
    <div
      className={cx(
        "rounded-xl border-2 px-4 py-3.5 transition-colors duration-200",
        !enabled
          ? "border-line bg-[#f5f5f4]"
          : checked
            ? "border-accent bg-accent-soft"
            : "border-line bg-white hover:border-carbon/40"
      )}
    >
      <Checkbox
        checked={checked}
        disabled={!enabled}
        onChange={(event) => onChange(event.target.checked)}
        label={
          <span className={enabled ? "font-medium text-carbon" : "font-medium text-muted"}>
            Esta misma persona va a aceptar el contrato
          </span>
        }
        hint={
          enabled
            ? `Marca esta casilla si ${holder.label} aceptará personalmente. Si va a aceptar alguien más, déjala sin marcar y elígelo abajo.`
            : holder
              ? `${holder.label} es una empresa. Elige abajo a la persona que aceptará en su nombre.`
              : "Primero elige arriba la empresa o persona titular."
        }
      />
    </div>
  );
}
