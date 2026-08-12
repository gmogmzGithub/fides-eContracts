import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalObjectStorage } from "@/lib/storage/local-object-storage";
import {
  ObjectStorageConfigurationError,
  ObjectStorageIntegrityError,
  getObjectStorage,
  resetObjectStorageForTests,
} from "@/lib/storage";

/**
 * `lib/storage/local-object-storage.ts` es el doble local del almacenamiento
 * privado de objetos: nada debe escribirse fuera del directorio autorizado.
 */

const METADATA_SUFFIX = ".fides-metadata.json";

let root = "";
let previousRoot: string | undefined;
const createdDirectories: string[] = [];

async function makeRoot(): Promise<string> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "contratos-objetos-")
  );
  createdDirectories.push(directory);
  return directory;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  previousRoot = process.env.FIDES_OBJECT_DIR;
  root = await makeRoot();
  process.env.FIDES_OBJECT_DIR = root;
  resetObjectStorageForTests();
});

afterEach(async () => {
  resetObjectStorageForTests();
  if (previousRoot === undefined) {
    delete process.env.FIDES_OBJECT_DIR;
  } else {
    process.env.FIDES_OBJECT_DIR = previousRoot;
  }
  while (createdDirectories.length > 0) {
    const directory = createdDirectories.pop();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
});

describe("LocalObjectStorage: identidad del adaptador", () => {
  it("se declara como proveedor local con un cubo fijo", () => {
    const storage = new LocalObjectStorage();
    expect(storage.provider).toBe("local");
    expect(storage.bucket).toBe("fides-local");
  });

  it("usa el directorio indicado en FIDES_OBJECT_DIR", async () => {
    const storage = new LocalObjectStorage();
    await storage.put({
      key: "contratos/paquete.zip",
      body: Buffer.from("paquete", "utf8"),
      contentType: "application/zip",
    });
    const written = path.join(root, "contratos", "paquete.zip");
    expect(await exists(written)).toBe(true);
    expect((await fs.readFile(written)).toString("utf8")).toBe("paquete");
  });

  it("admite una raíz explícita distinta de la variable de entorno", async () => {
    const other = await makeRoot();
    const storage = new LocalObjectStorage(other);
    await storage.put({
      key: "a/b.txt",
      body: Buffer.from("otro", "utf8"),
      contentType: "text/plain",
    });
    expect(await exists(path.join(other, "a", "b.txt"))).toBe(true);
    expect(await exists(path.join(root, "a", "b.txt"))).toBe(false);
  });

  it("cae al directorio temporal del sistema sin FIDES_OBJECT_DIR", async () => {
    delete process.env.FIDES_OBJECT_DIR;
    const storage = new LocalObjectStorage();
    const key = `pruebas/${process.pid}-${Date.now()}.txt`;
    const expected = path.join(os.tmpdir(), "fides-object-storage", key);
    try {
      await storage.put({
        key,
        body: Buffer.from("temporal", "utf8"),
        contentType: "text/plain",
      });
      expect(await exists(expected)).toBe(true);
    } finally {
      await fs.rm(path.join(os.tmpdir(), "fides-object-storage", "pruebas"), {
        recursive: true,
        force: true,
      });
    }
  });
});

describe("LocalObjectStorage: ciclo de vida del objeto", () => {
  it("guarda, recupera, describe y borra un objeto", async () => {
    const storage = new LocalObjectStorage();
    const body = Buffer.from("contenido contractual", "utf8");

    const location = await storage.put({
      key: "expediente/contrato.md",
      body,
      contentType: "text/markdown; charset=utf-8",
      metadata: { organizacion: "org-1", referencia: "AC-2026-000123" },
    });
    expect(location).toEqual({
      provider: "local",
      bucket: "fides-local",
      key: "expediente/contrato.md",
      contentType: "text/markdown; charset=utf-8",
      size: body.byteLength,
    });

    const stored = await storage.get("expediente/contrato.md");
    expect(Buffer.compare(stored.body, body)).toBe(0);
    expect(stored.provider).toBe("local");
    expect(stored.bucket).toBe("fides-local");
    expect(stored.key).toBe("expediente/contrato.md");
    expect(stored.contentType).toBe("text/markdown; charset=utf-8");
    expect(stored.size).toBe(body.byteLength);
    expect(stored.eTag).toBeUndefined();
    expect(stored.metadata).toEqual({
      organizacion: "org-1",
      referencia: "AC-2026-000123",
    });

    const described = await storage.head("expediente/contrato.md");
    expect(described).toEqual({
      provider: "local",
      bucket: "fides-local",
      key: "expediente/contrato.md",
      contentType: "text/markdown; charset=utf-8",
      size: body.byteLength,
      eTag: undefined,
    });

    await storage.delete("expediente/contrato.md");
    expect(await storage.head("expediente/contrato.md")).toBeNull();
    expect(await exists(path.join(root, "expediente", "contrato.md"))).toBe(false);
    expect(
      await exists(
        path.join(root, "expediente", `contrato.md${METADATA_SUFFIX}`)
      )
    ).toBe(false);
  });

  it("conserva los metadatos en un archivo lateral", async () => {
    const storage = new LocalObjectStorage();
    await storage.put({
      key: "evidencia/registro.json",
      body: Buffer.from("{}", "utf8"),
      contentType: "application/json",
      metadata: { intento: "2" },
    });
    const sidecar = path.join(
      root,
      "evidencia",
      `registro.json${METADATA_SUFFIX}`
    );
    expect(JSON.parse(await fs.readFile(sidecar, "utf8"))).toEqual({
      contentType: "application/json",
      size: 2,
      metadata: { intento: "2" },
    });
  });

  it("usa un objeto de metadatos vacío cuando no se envía ninguno", async () => {
    const storage = new LocalObjectStorage();
    await storage.put({
      key: "sin-metadatos.bin",
      body: Buffer.from([1, 2, 3]),
      contentType: "application/octet-stream",
    });
    const stored = await storage.get("sin-metadatos.bin");
    expect(stored.metadata).toEqual({});
    expect(stored.size).toBe(3);
  });

  it("guarda contenido binario sin alterarlo y admite cuerpos vacíos", async () => {
    const storage = new LocalObjectStorage();
    const binary = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x7f]);
    await storage.put({
      key: "binario.bin",
      body: binary,
      contentType: "application/octet-stream",
    });
    expect(Buffer.compare((await storage.get("binario.bin")).body, binary)).toBe(0);

    const empty = await storage.put({
      key: "vacio.bin",
      body: Buffer.alloc(0),
      contentType: "application/octet-stream",
    });
    expect(empty.size).toBe(0);
    expect((await storage.get("vacio.bin")).body.byteLength).toBe(0);
    expect((await storage.head("vacio.bin"))?.size).toBe(0);
  });

  it("sustituye el objeto y sus metadatos al volver a guardarlo", async () => {
    const storage = new LocalObjectStorage();
    await storage.put({
      key: "contrato.md",
      body: Buffer.from("primera versión", "utf8"),
      contentType: "text/markdown",
      metadata: { intento: "1" },
    });
    await storage.put({
      key: "contrato.md",
      body: Buffer.from("segunda", "utf8"),
      contentType: "text/plain",
      metadata: { intento: "2" },
    });
    const stored = await storage.get("contrato.md");
    expect(stored.body.toString("utf8")).toBe("segunda");
    expect(stored.contentType).toBe("text/plain");
    expect(stored.metadata).toEqual({ intento: "2" });

    const remaining = await fs.readdir(root);
    expect(remaining.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("crea los directorios intermedios de las claves anidadas", async () => {
    const storage = new LocalObjectStorage();
    await storage.put({
      key: "org/2026/01/expediente/contrato.md",
      body: Buffer.from("anidado", "utf8"),
      contentType: "text/markdown",
    });
    expect(
      await exists(path.join(root, "org", "2026", "01", "expediente", "contrato.md"))
    ).toBe(true);
  });

  it("normaliza los segmentos redundantes de la clave", async () => {
    const storage = new LocalObjectStorage();
    await storage.put({
      key: "org/./expediente//contrato.md",
      body: Buffer.from("normalizado", "utf8"),
      contentType: "text/markdown",
    });
    expect(await exists(path.join(root, "org", "expediente", "contrato.md"))).toBe(
      true
    );
    expect(
      (await storage.get("org/expediente/contrato.md")).body.toString("utf8")
    ).toBe("normalizado");
  });

  it("devuelve null al describir una clave inexistente", async () => {
    const storage = new LocalObjectStorage();
    expect(await storage.head("no-existe.txt")).toBeNull();
    expect(await storage.head("carpeta/profunda/no-existe.txt")).toBeNull();
  });

  it("devuelve null cuando faltan los metadatos del objeto", async () => {
    const storage = new LocalObjectStorage();
    await storage.put({
      key: "huerfano.txt",
      body: Buffer.from("x", "utf8"),
      contentType: "text/plain",
    });
    await fs.rm(path.join(root, `huerfano.txt${METADATA_SUFFIX}`));
    expect(await storage.head("huerfano.txt")).toBeNull();
  });

  it("propaga los errores de lectura que no son «archivo ausente»", async () => {
    const storage = new LocalObjectStorage();
    await storage.put({
      key: "ilegible.txt",
      body: Buffer.from("x", "utf8"),
      contentType: "text/plain",
    });
    const sidecar = path.join(root, `ilegible.txt${METADATA_SUFFIX}`);
    await fs.rm(sidecar);
    await fs.mkdir(sidecar);
    await expect(storage.head("ilegible.txt")).rejects.toThrow(/EISDIR/);
  });

  it("rechaza la lectura de una clave inexistente", async () => {
    const storage = new LocalObjectStorage();
    await expect(storage.get("no-existe.txt")).rejects.toThrow(/ENOENT/);
  });

  it("no falla al borrar una clave inexistente", async () => {
    const storage = new LocalObjectStorage();
    await expect(storage.delete("no-existe.txt")).resolves.toBeUndefined();
    await expect(storage.delete("carpeta/no-existe.txt")).resolves.toBeUndefined();
  });
});

describe("LocalObjectStorage: claves rechazadas", () => {
  const invalidas = ["", "/absoluta.txt", "/", "a\\b.txt", "..\\fuera.txt", "a\0b"];

  it("rechaza las claves vacías, absolutas o con caracteres prohibidos", async () => {
    const storage = new LocalObjectStorage();
    for (const key of invalidas) {
      await expect(
        storage.put({
          key,
          body: Buffer.from("x", "utf8"),
          contentType: "text/plain",
        })
      ).rejects.toThrow("La clave del objeto no es válida.");
      await expect(storage.get(key)).rejects.toThrow(
        "La clave del objeto no es válida."
      );
      await expect(storage.head(key)).rejects.toThrow(
        "La clave del objeto no es válida."
      );
      await expect(storage.delete(key)).rejects.toThrow(
        "La clave del objeto no es válida."
      );
    }
  });

  it("rechaza las claves que salen del directorio autorizado", async () => {
    const storage = new LocalObjectStorage();
    for (const key of [
      "..",
      "../fuera.txt",
      "../../etc/passwd",
      "org/../../fuera.txt",
      "./../fuera.txt",
    ]) {
      await expect(
        storage.put({
          key,
          body: Buffer.from("x", "utf8"),
          contentType: "text/plain",
        })
      ).rejects.toThrow("La clave del objeto sale del directorio autorizado.");
      await expect(storage.head(key)).rejects.toThrow(
        "La clave del objeto sale del directorio autorizado."
      );
    }
  });

  it("no escribe nada fuera de la raíz cuando la clave es maliciosa", async () => {
    const storage = new LocalObjectStorage();
    await expect(
      storage.put({
        key: "../fuera.txt",
        body: Buffer.from("x", "utf8"),
        contentType: "text/plain",
      })
    ).rejects.toThrow(/directorio autorizado/);
    expect(await exists(path.join(path.dirname(root), "fuera.txt"))).toBe(false);
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("mantiene dentro de la raíz las claves con saltos internos compensados", async () => {
    const storage = new LocalObjectStorage();
    await storage.put({
      key: "org/expediente/../contrato.md",
      body: Buffer.from("compensado", "utf8"),
      contentType: "text/markdown",
    });
    expect(await exists(path.join(root, "org", "contrato.md"))).toBe(true);
    expect(await exists(path.join(root, "org", "expediente"))).toBe(false);
  });

  // Falla a propósito: documenta un defecto pendiente de corregir en `lib/`.
  // `resolveKey` acepta las claves que se normalizan a "." (la propia raíz),
  // como "." o "org/..", en lugar de rechazarlas; la escritura falla después
  // con un error opaco del sistema de archivos.
  it("rechaza las claves que apuntan a la raíz del almacenamiento", async () => {
    const storage = new LocalObjectStorage();
    for (const key of [".", "org/.."]) {
      await expect(
        storage.put({
          key,
          body: Buffer.from("x", "utf8"),
          contentType: "text/plain",
        })
      ).rejects.toThrow(/La clave del objeto/);
    }
  });
});

describe("getObjectStorage", () => {
  it("memoriza una sola instancia del almacenamiento", () => {
    const first = getObjectStorage();
    const second = getObjectStorage();
    expect(first).toBe(second);
    expect(first).toBeInstanceOf(LocalObjectStorage);
    expect(first.provider).toBe("local");
    expect(first.bucket).toBe("fides-local");
  });

  it("olvida la instancia memorizada al reiniciarla para las pruebas", async () => {
    const first = getObjectStorage();
    resetObjectStorageForTests();
    const other = await makeRoot();
    process.env.FIDES_OBJECT_DIR = other;
    const second = getObjectStorage();
    expect(second).not.toBe(first);

    await second.put({
      key: "reiniciado.txt",
      body: Buffer.from("nueva raíz", "utf8"),
      contentType: "text/plain",
    });
    expect(await exists(path.join(other, "reiniciado.txt"))).toBe(true);
    expect(await exists(path.join(root, "reiniciado.txt"))).toBe(false);
  });

  it("reexporta los contratos y errores del almacenamiento de objetos", () => {
    const configuration = new ObjectStorageConfigurationError("sin cubo");
    expect(configuration).toBeInstanceOf(Error);
    expect(configuration.name).toBe("ObjectStorageConfigurationError");
    expect(configuration.message).toBe("sin cubo");

    const integrity = new ObjectStorageIntegrityError("huella distinta");
    expect(integrity).toBeInstanceOf(Error);
    expect(integrity.name).toBe("ObjectStorageIntegrityError");
    expect(integrity.message).toBe("huella distinta");
  });
});
