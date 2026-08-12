#!/usr/bin/env node
// Aplicador de migraciones de Fides.
// Ejecuta `db/migrations/*.sql` en orden, cada una dentro de su transacción,
// y registra versión y suma de verificación en `fides.schema_migrations`.
// Es seguro repetirlo: una migración ya aplicada se omite y una migración
// alterada después de aplicarse detiene el proceso.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { DEFAULT_DATABASE_URL } from "./defaults.mjs";


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

const CONNECT_ATTEMPTS = Number(process.env.FIDES_DB_CONNECT_ATTEMPTS ?? 30);
const CONNECT_DELAY_MS = Number(process.env.FIDES_DB_CONNECT_DELAY_MS ?? 1000);

// Candado de sesión que serializa aplicadores simultáneos: la aplicación, el
// worker y `db:migrate` pueden arrancar a la vez y sin él dos procesos leerían
// `schema_migrations` vacía y ejecutarían la misma migración dos veces.
// Es constante y propio de este aplicador.
const MIGRATION_LOCK_KEY = 4_070_100_101n;

function log(message) {
  process.stdout.write(`[migrate] ${message}\n`);
}

function checksumOf(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDatabase(sql) {
  let lastError;
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
    try {
      await sql`SELECT 1`;
      return;
    } catch (error) {
      lastError = error;
      if (attempt === CONNECT_ATTEMPTS) break;
      if (attempt === 1) log("esperando a PostgreSQL…");
      await sleep(CONNECT_DELAY_MS);
    }
  }
  throw new Error(
    `no fue posible conectar a PostgreSQL: ${lastError?.message ?? "sin detalle"}`
  );
}

async function listMigrations() {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en"));
}

async function ensureTrackingTable(sql) {
  // La migración inicial crea el esquema `fides`; la tabla de control debe
  // existir antes, así que el esquema se crea aquí de forma idempotente.
  await sql`CREATE SCHEMA IF NOT EXISTS fides`;
  await sql`
    CREATE TABLE IF NOT EXISTS fides.schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function main() {
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const sql = postgres(url, {
    max: 1,
    onnotice: () => undefined,
    idle_timeout: 5,
    connect_timeout: 10,
  });

  let locked = false;
  try {
    await waitForDatabase(sql);
    // `max: 1` garantiza que el candado y las migraciones viajan por la misma
    // conexión, así que el candado de sesión cubre todo el recorrido.
    await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY}::bigint)`;
    locked = true;
    await ensureTrackingTable(sql);

    const applied = new Map(
      (await sql`SELECT version, checksum FROM fides.schema_migrations`).map(
        (row) => [row.version, row.checksum]
      )
    );

    const files = await listMigrations();
    if (files.length === 0) {
      log("no hay migraciones que aplicar");
      return;
    }

    let pending = 0;
    for (const file of files) {
      const text = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      const checksum = checksumOf(text);
      const previous = applied.get(file);

      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(
            `la migración ya aplicada '${file}' cambió de contenido ` +
              `(registrada ${previous.slice(0, 12)}…, actual ${checksum.slice(0, 12)}…). ` +
              "Crea una migración nueva en lugar de editar una aplicada."
          );
        }
        log(`omitida ${file} (ya aplicada)`);
        continue;
      }

      pending += 1;
      const startedAt = Date.now();
      await sql.begin(async (tx) => {
        await tx.unsafe(text).simple();
        await tx`
          INSERT INTO fides.schema_migrations (version, checksum)
          VALUES (${file}, ${checksum})
        `;
      });
      log(`aplicada ${file} en ${Date.now() - startedAt} ms`);
    }

    log(
      pending === 0
        ? "esquema al día"
        : `esquema al día (${pending} migración(es) nueva(s))`
    );
  } finally {
    if (locked) {
      try {
        await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY}::bigint)`;
      } catch {
        // Cerrar la conexión libera el candado de todos modos.
      }
    }
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  process.stderr.write(`[migrate] error: ${error?.message ?? error}\n`);
  process.exitCode = 1;
});
