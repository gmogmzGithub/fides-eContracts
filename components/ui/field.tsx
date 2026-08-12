import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cx } from "@/components/ui/cx";

const CONTROL =
  "block w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-[0.9375rem] text-ink " +
  "placeholder:text-muted transition-colors duration-200 " +
  "focus:border-carbon focus:outline-2 focus:outline-offset-2 focus:outline-accent " +
  "disabled:cursor-not-allowed disabled:bg-[#f5f5f4] disabled:text-muted";

const INVALID = "border-danger focus:border-danger";

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /**
   * `id` del control. Si se omite, la etiqueta envuelve al control y la
   * asociación queda implícita.
   */
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  className,
  children,
}: FieldProps) {
  const head = (
    <span className="flex items-baseline gap-1.5 text-sm font-medium text-carbon">
      {label}
      {required ? (
        <span className="text-accent-strong" aria-hidden="true">
          *
        </span>
      ) : null}
    </span>
  );
  const tail = (
    <>
      {hint ? <p className="text-xs leading-relaxed text-muted">{hint}</p> : null}
      {error ? (
        <p className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );

  if (htmlFor) {
    return (
      <div className={cx("grid gap-1.5", className)}>
        <label htmlFor={htmlFor} className="cursor-pointer">
          {head}
        </label>
        {children}
        {tail}
      </div>
    );
  }

  return (
    <label className={cx("grid cursor-pointer gap-1.5", className)}>
      {head}
      {children}
      {tail}
    </label>
  );
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function TextInput({ invalid, className, id, name, ...rest }: TextInputProps) {
  return (
    <input
      id={id ?? name}
      name={name}
      aria-invalid={invalid || undefined}
      className={cx(CONTROL, invalid && INVALID, className)}
      {...rest}
    />
  );
}

export interface SuggestInputProps extends TextInputProps {
  suggestions: string[];
}

/**
 * Texto libre con sugerencias. A diferencia de `Select`, la lista sólo propone:
 * quien captura puede escribir una ciudad, un aeropuerto o una carga que no
 * esté ahí. Se apoya en `<datalist>` para que el navegador filtre conforme se
 * escribe, sin JavaScript propio.
 */
export function SuggestInput({ suggestions, id, name, ...rest }: SuggestInputProps) {
  const listId = `${id ?? name}-sugerencias`;
  return (
    <>
      <TextInput {...rest} id={id} name={name} list={listId} autoComplete="off" />
      <datalist id={listId}>
        {suggestions.map((suggestion) => (
          // Una opción de `datalist` no es un control etiquetable: el texto
          // visible lo pone el navegador a partir de `value`.
          // oxlint-disable-next-line jsx-a11y/control-has-associated-label
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
    </>
  );
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function TextArea({
  invalid,
  className,
  id,
  name,
  rows = 5,
  ...rest
}: TextAreaProps) {
  return (
    <textarea
      id={id ?? name}
      name={name}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cx(CONTROL, "resize-y", invalid && INVALID, className)}
      {...rest}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
  placeholder?: string;
  invalid?: boolean;
}

export function Select({
  options,
  placeholder,
  invalid,
  className,
  id,
  name,
  ...rest
}: SelectProps) {
  return (
    <select
      id={id ?? name}
      name={name}
      aria-invalid={invalid || undefined}
      className={cx(CONTROL, "cursor-pointer pr-9", invalid && INVALID, className)}
      {...rest}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  hint?: string;
}

export function Checkbox({ label, hint, className, id, name, ...rest }: CheckboxProps) {
  return (
    <label
      className={cx(
        "flex cursor-pointer items-start gap-2.5 text-[0.9375rem] leading-snug text-carbon",
        className
      )}
    >
      <input
        type="checkbox"
        id={id ?? name}
        name={name}
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-line text-accent accent-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        {...rest}
      />
      <span className="grid gap-0.5">
        <span>{label}</span>
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

export interface RadioOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  name: string;
  options: RadioOption[];
  legend?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  defaultValue?: string;
  className?: string;
}

export function RadioGroup({
  name,
  options,
  legend,
  hint,
  error,
  required,
  defaultValue,
  className,
}: RadioGroupProps) {
  return (
    <fieldset className={cx("grid gap-2", className)}>
      {legend ? (
        <legend className="mb-1 flex items-baseline gap-1.5 text-sm font-medium text-carbon">
          {legend}
          {required ? (
            <span className="text-accent-strong" aria-hidden="true">
              *
            </span>
          ) : null}
        </legend>
      ) : null}
      {options.map((option) => (
        <label
          key={option.value}
          className={cx(
            "flex items-start gap-2.5 rounded-lg border border-line bg-white px-3.5 py-2.5 text-[0.9375rem] text-carbon transition-colors duration-200",
            option.disabled
              ? "cursor-not-allowed opacity-60"
              : "cursor-pointer hover:border-carbon/40"
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            defaultChecked={defaultValue === option.value}
            disabled={option.disabled}
            required={required}
            className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
          <span className="grid gap-0.5">
            <span>{option.label}</span>
            {option.description ? (
              <span className="text-xs leading-relaxed text-muted">
                {option.description}
              </span>
            ) : null}
          </span>
        </label>
      ))}
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      {error ? (
        <p className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
