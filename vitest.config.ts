import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.resolve(import.meta.dirname);

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` aborta fuera de un React Server Component; en las pruebas
      // se sustituye por un módulo vacío para poder importar el dominio.
      "server-only": path.join(root, "tests/stubs/server-only.ts"),
      "@": root,
    },
  },
  test: {
    environment: "node",
    globals: false,
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgres://fides:fides_local_only@127.0.0.1:54329/fides_test",
      FIDES_OBJECT_DIR: path.join(root, ".data", "pruebas-objetos"),
      FIDES_APP_URL: "http://localhost:3002",
      NODE_ENV: "test",
    },
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // Las pruebas de dominio comparten una base de datos: se ejecutan en un
    // solo proceso para que el truncado entre pruebas sea determinista.
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text", "json-summary"],
      reportsDirectory: "coverage",
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/*.d.ts"],
      // La cobertura del dominio está completa: cualquier código nuevo sin
      // prueba baja el umbral y detiene la integración continua.
      thresholds: {
        lines: 100,
        statements: 100,
        functions: 100,
        branches: 100,
      },
    },
  },
});
