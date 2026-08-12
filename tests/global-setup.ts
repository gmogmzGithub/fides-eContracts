import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

/**
 * Crea una base de datos limpia para las pruebas y aplica las migraciones.
 * Nunca toca la base local de trabajo: usa `fides_test`.
 */
export default async function setup() {
  const adminUrl =
    process.env.TEST_ADMIN_DATABASE_URL ??
    "postgres://fides:fides_local_only@127.0.0.1:54329/postgres";
  const testDatabase = process.env.TEST_DATABASE_NAME ?? "fides_test";

  const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  try {
    await admin.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = '${testDatabase}' AND pid <> pg_backend_pid()`
    );
    await admin.unsafe(`DROP DATABASE IF EXISTS ${testDatabase}`);
    await admin.unsafe(`CREATE DATABASE ${testDatabase}`);
  } finally {
    await admin.end();
  }

  const target = postgres(
    adminUrl.replace(/\/[^/]*$/, `/${testDatabase}`),
    { max: 1, onnotice: () => undefined }
  );
  try {
    const directory = path.join(import.meta.dirname, "..", "db", "migrations");
    const files = (await fs.readdir(directory)).filter((file) =>
      file.endsWith(".sql")
    );
    for (const file of files.sort()) {
      await target.unsafe(await fs.readFile(path.join(directory, file), "utf8"));
    }
  } finally {
    await target.end();
  }
}
