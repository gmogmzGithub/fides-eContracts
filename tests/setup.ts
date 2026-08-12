import { afterAll, beforeEach } from "vitest";
import { sql } from "@/lib/db";
import { truncateAll } from "@/tests/helpers/database";

// Cada prueba comienza con la base vacía: el aislamiento por Organización se
// comprueba con datos propios, no con residuos de otra prueba.
beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
  // `lib/db.ts` memoriza el cliente en `globalThis` fuera de producción. Sin
  // limpiarlo, el siguiente archivo de pruebas reutilizaría un pool ya cerrado.
  delete (globalThis as { fidesSql?: unknown }).fidesSql;
});
