/** Une clases condicionales sin dependencias externas. */
export function cx(
  ...values: (string | false | null | undefined)[]
): string {
  return values.filter(Boolean).join(" ");
}
