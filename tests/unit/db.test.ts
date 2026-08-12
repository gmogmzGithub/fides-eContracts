import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import { sql } from "@/lib/db";

/**
 * `lib/db.ts` es el único punto de acceso a PostgreSQL. Fuera de producción
 * memoriza el cliente en `globalThis` para que el recargado en caliente de
 * Next.js no abra un pool nuevo en cada compilación; en producción el módulo
 * se evalúa una sola vez y no debe ensuciar el objeto global.
 */

interface GlobalConCliente {
  fidesSql?: postgres.Sql;
}

const globalConCliente = globalThis as GlobalConCliente;

/** `NODE_ENV` está tipado como literal: se escribe por el registro de entorno. */
function fijarEntorno(valor: string): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = valor;
}

const entornoOriginal = process.env.NODE_ENV;
const urlOriginal = process.env.DATABASE_URL;
const clienteOriginal = globalConCliente.fidesSql;

/** Clientes creados por una prueba; se cierran siempre para no dejar pools. */
const creados: postgres.Sql[] = [];

async function importarModuloLimpio(): Promise<typeof import("@/lib/db")> {
  vi.resetModules();
  return import("@/lib/db");
}

beforeEach(() => {
  delete globalConCliente.fidesSql;
});

afterEach(async () => {
  while (creados.length > 0) {
    const cliente = creados.pop();
    if (cliente) await cliente.end({ timeout: 5 });
  }
  vi.resetModules();
  fijarEntorno(entornoOriginal ?? "test");
  if (urlOriginal === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = urlOriginal;
  if (clienteOriginal === undefined) delete globalConCliente.fidesSql;
  else globalConCliente.fidesSql = clienteOriginal;
});

describe("lib/db", () => {
  describe("memorización del cliente", () => {
    it("guarda el cliente en globalThis fuera de producción", async () => {
      fijarEntorno("development");

      const primero = await importarModuloLimpio();
      creados.push(primero.sql);

      expect(globalConCliente.fidesSql).toBe(primero.sql);
    });

    it("reutiliza el cliente memorizado en una segunda evaluación del módulo", async () => {
      fijarEntorno("test");

      const primero = await importarModuloLimpio();
      creados.push(primero.sql);
      const segundo = await importarModuloLimpio();

      // La segunda evaluación toma el cliente de `globalThis` y no abre otro
      // pool: el recargado en caliente no multiplica conexiones.
      expect(segundo.sql).toBe(primero.sql);
      expect(globalConCliente.fidesSql).toBe(primero.sql);
      expect(creados).toHaveLength(1);
    });

    it("no memoriza el cliente en producción", async () => {
      fijarEntorno("production");

      const modulo = await importarModuloLimpio();
      creados.push(modulo.sql);

      expect(globalConCliente.fidesSql).toBeUndefined();
      expect(modulo.sql).not.toBe(clienteOriginal);
    });

    it("abre un cliente nuevo por evaluación cuando corre en producción", async () => {
      fijarEntorno("production");

      const primero = await importarModuloLimpio();
      creados.push(primero.sql);
      const segundo = await importarModuloLimpio();
      creados.push(segundo.sql);

      expect(segundo.sql).not.toBe(primero.sql);
      expect(globalConCliente.fidesSql).toBeUndefined();
    });
  });

  describe("cadena de conexión", () => {
    it("usa DATABASE_URL cuando está definida", async () => {
      process.env.DATABASE_URL =
        "postgres://otro:secreto@127.0.0.1:54329/fides_otra_base";

      const modulo = await importarModuloLimpio();
      creados.push(modulo.sql);

      expect(modulo.sql.options.database).toBe("fides_otra_base");
      expect(modulo.sql.options.user).toBe("otro");
    });

    it("cae en la base local por omisión cuando no hay DATABASE_URL", async () => {
      delete process.env.DATABASE_URL;

      const modulo = await importarModuloLimpio();
      creados.push(modulo.sql);

      expect(modulo.DEFAULT_DATABASE_URL).toBe(
        "postgres://fides:fides_local_only@127.0.0.1:54329/fides"
      );
      expect(modulo.sql.options.database).toBe("fides");
      expect(modulo.sql.options.user).toBe("fides");
      expect(modulo.sql.options.host).toEqual(["127.0.0.1"]);
      expect(modulo.sql.options.port).toEqual([54329]);
    });
  });

  describe("opciones del cliente compartido", () => {
    it("acota el pool y fija el search_path de la aplicación", () => {
      expect(sql.options.max).toBe(10);
      expect(sql.options.connection.search_path).toBe("fides,public");
    });

    it("silencia los avisos de PostgreSQL en lugar de imprimirlos", async () => {
      const registro = vi.spyOn(console, "log").mockImplementation(() => undefined);
      try {
        // `DROP TABLE IF EXISTS` sobre una tabla ausente emite un NOTICE: es la
        // vía real para comprobar que `onnotice` lo descarta.
        await sql`DROP TABLE IF EXISTS tabla_sintetica_inexistente`;
        expect(registro).not.toHaveBeenCalled();
      } finally {
        registro.mockRestore();
      }
    });
  });
});
