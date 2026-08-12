const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un identificador que no es UUID nunca llega a PostgreSQL como `::uuid`. */
export function isUuid(value: string | undefined | null): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function asUuid(value: string | undefined | null): string | undefined {
  return isUuid(value) ? value : undefined;
}
