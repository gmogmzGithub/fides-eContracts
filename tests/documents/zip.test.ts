import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { createZip, crc32, type ZipEntry } from "@/lib/zip";

/**
 * `lib/zip.ts` sella el Paquete contractual frío: su salida debe ser
 * reproducible byte a byte y legible por herramientas ZIP externas.
 */

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const FLAG_UTF8 = 0x0800;

interface ArchiveEntry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  dosTime: number;
  dosDate: number;
  data: Buffer;
}

/** Recorre el directorio central y valida su coherencia con las cabeceras locales. */
function readArchive(archive: Buffer): ArchiveEntry[] {
  const eocd = archive.length - 22;
  expect(archive.readUInt32LE(eocd)).toBe(SIG_EOCD);
  expect(archive.readUInt16LE(eocd + 4)).toBe(0);
  expect(archive.readUInt16LE(eocd + 6)).toBe(0);
  expect(archive.readUInt16LE(eocd + 20)).toBe(0);

  const total = archive.readUInt16LE(eocd + 8);
  expect(archive.readUInt16LE(eocd + 10)).toBe(total);
  const directorySize = archive.readUInt32LE(eocd + 12);
  const directoryOffset = archive.readUInt32LE(eocd + 16);
  expect(directoryOffset + directorySize).toBe(eocd);

  const entries: ArchiveEntry[] = [];
  let cursor = directoryOffset;
  for (let index = 0; index < total; index += 1) {
    expect(archive.readUInt32LE(cursor)).toBe(SIG_CENTRAL);
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString("utf8");

    expect(archive.readUInt32LE(localOffset)).toBe(SIG_LOCAL);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    expect(
      archive
        .subarray(localOffset + 30, localOffset + 30 + localNameLength)
        .toString("utf8")
    ).toBe(name);
    expect(archive.readUInt16LE(localOffset + 8)).toBe(method);
    expect(archive.readUInt32LE(localOffset + 18)).toBe(compressedSize);
    expect(archive.readUInt32LE(localOffset + 22)).toBe(uncompressedSize);

    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const payload = archive.subarray(dataStart, dataStart + compressedSize);

    entries.push({
      name,
      flags: archive.readUInt16LE(cursor + 8),
      method,
      crc: archive.readUInt32LE(cursor + 16),
      compressedSize,
      uncompressedSize,
      localOffset,
      dosTime: archive.readUInt16LE(cursor + 12),
      dosDate: archive.readUInt16LE(cursor + 14),
      data: method === METHOD_DEFLATE ? inflateRawSync(payload) : Buffer.from(payload),
    });

    cursor += 46 + nameLength + extraLength + commentLength;
  }
  expect(cursor).toBe(directoryOffset + directorySize);
  return entries;
}

/**
 * Búfer simulado para las guardas de 4 GB: reservar esa memoria de verdad no es
 * viable en una prueba, así que se entrega un objeto con forma de `Buffer` que
 * sólo miente en `length` y únicamente en la lectura indicada.
 *
 * `createZip` lee `data.length` en un orden fijo por entrada almacenada:
 *   1. la condición del bucle de `crc32`;
 *   2. `data.length > 0`, que decide si vale la pena desinflar;
 *   3 y 4. la guarda por entrada, sobre el dato y sobre la carga útil;
 *   5-8. los cuatro tamaños escritos en la cabecera local y en el directorio;
 *   9. la suma del desplazamiento acumulado.
 * Si ese orden cambiara, la prueba dejaría de ver el error esperado y fallaría.
 */
function bufferConLongitudSimulada(lectura: number, valor: number): Buffer {
  let leidas = 0;
  const simulado = {
    get length(): number {
      leidas += 1;
      return leidas === lectura ? valor : 0;
    },
  };
  return simulado as unknown as Buffer;
}

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "contratos-zip-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
});

describe("crc32", () => {
  it("reproduce los vectores conocidos de CRC-32/ISO-HDLC", () => {
    expect(crc32(Buffer.alloc(0))).toBe(0x00000000);
    expect(crc32(Buffer.from("123456789", "utf8"))).toBe(0xcbf43926);
    expect(crc32(Buffer.from([0x00]))).toBe(0xd202ef8d);
    expect(
      crc32(Buffer.from("The quick brown fox jumps over the lazy dog", "utf8"))
    ).toBe(0x414fa339);
  });

  it("devuelve siempre un entero sin signo de 32 bits", () => {
    for (const sample of ["a", "contrato", "ñ", "\u0000\u00ff"]) {
      const value = crc32(Buffer.from(sample, "utf8"));
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("coincide con el CRC que se escribe en el directorio central", () => {
    const data = Buffer.from("# Contrato\n", "utf8");
    const [entry] = readArchive(createZip([{ name: "contrato.md", data }]));
    expect(entry.crc).toBe(crc32(data));
  });
});

describe("createZip", () => {
  it("produce el mismo archivo byte a byte en dos llamadas", () => {
    const entries: ZipEntry[] = [
      { name: "contrato.md", data: Buffer.from("# Contrato\n", "utf8") },
      { name: "manifiesto.json", data: Buffer.from("{}", "utf8") },
      { name: "evidencia/registro.txt", data: Buffer.from("x".repeat(4096), "utf8") },
    ];
    const first = createZip(entries);
    const second = createZip(entries);
    expect(Buffer.compare(first, second)).toBe(0);
  });

  it("fija la fecha MS-DOS interna para que el hash sea recalculable", () => {
    const expectedDate = ((2020 - 1980) << 9) | (1 << 5) | 1;
    const expectedTime = 12 << 11;
    for (const entry of readArchive(
      createZip([
        { name: "a.txt", data: Buffer.from("a", "utf8") },
        { name: "b.txt", data: Buffer.from("b", "utf8") },
      ])
    )) {
      expect(entry.dosDate).toBe(expectedDate);
      expect(entry.dosTime).toBe(expectedTime);
    }
  });

  it("guarda las entradas en el orden recibido", () => {
    const names = ["z.txt", "a.txt", "m/n.txt"];
    const archive = createZip(
      names.map((name) => ({ name, data: Buffer.from(name, "utf8") }))
    );
    const entries = readArchive(archive);
    expect(entries.map((entry) => entry.name)).toEqual(names);
    expect(entries[0].localOffset).toBe(0);
    for (let index = 1; index < entries.length; index += 1) {
      expect(entries[index].localOffset).toBeGreaterThan(
        entries[index - 1].localOffset
      );
    }
  });

  it("desinfla cuando comprimir reduce el tamaño", () => {
    const data = Buffer.from("contrato ".repeat(400), "utf8");
    const [entry] = readArchive(createZip([{ name: "repetido.txt", data }]));
    expect(entry.method).toBe(METHOD_DEFLATE);
    expect(entry.compressedSize).toBeLessThan(data.length);
    expect(entry.uncompressedSize).toBe(data.length);
    expect(Buffer.compare(entry.data, data)).toBe(0);
  });

  it("guarda sin comprimir cuando desinflar no reduce el tamaño", () => {
    const incompressible = randomBytes(64);
    const [random, tiny] = readArchive(
      createZip([
        { name: "aleatorio.bin", data: incompressible },
        { name: "corto.txt", data: Buffer.from("hi", "utf8") },
      ])
    );
    expect(random.method).toBe(METHOD_STORE);
    expect(random.compressedSize).toBe(random.uncompressedSize);
    expect(Buffer.compare(random.data, incompressible)).toBe(0);
    expect(tiny.method).toBe(METHOD_STORE);
    expect(tiny.data.toString("utf8")).toBe("hi");
  });

  it("admite archivos vacíos como entradas almacenadas", () => {
    const [entry] = readArchive(
      createZip([{ name: "vacio.txt", data: Buffer.alloc(0) }])
    );
    expect(entry.method).toBe(METHOD_STORE);
    expect(entry.crc).toBe(0);
    expect(entry.compressedSize).toBe(0);
    expect(entry.uncompressedSize).toBe(0);
    expect(entry.data.length).toBe(0);
  });

  it("construye un archivo válido sin ninguna entrada", () => {
    const archive = createZip([]);
    expect(archive.length).toBe(22);
    expect(readArchive(archive)).toEqual([]);
  });

  it("conserva rutas anidadas y normaliza los separadores", () => {
    const entries = readArchive(
      createZip([
        { name: "paquete/contrato/texto.md", data: Buffer.from("uno", "utf8") },
        { name: "paquete\\evidencia\\registro.json", data: Buffer.from("dos", "utf8") },
        { name: "paquete//manifiesto.json", data: Buffer.from("tres", "utf8") },
        { name: "  paquete/espacios.txt  ", data: Buffer.from("cuatro", "utf8") },
      ])
    );
    expect(entries.map((entry) => entry.name)).toEqual([
      "paquete/contrato/texto.md",
      "paquete/evidencia/registro.json",
      "paquete/manifiesto.json",
      "paquete/espacios.txt",
    ]);
  });

  it("convierte las rutas absolutas en relativas para que no escapen del paquete", () => {
    const entries = readArchive(
      createZip([
        { name: "/etc/passwd", data: Buffer.from("uno", "utf8") },
        { name: "///raiz.txt", data: Buffer.from("dos", "utf8") },
        { name: "\\windows\\system32\\host", data: Buffer.from("tres", "utf8") },
      ])
    );
    expect(entries.map((entry) => entry.name)).toEqual([
      "etc/passwd",
      "raiz.txt",
      "windows/system32/host",
    ]);
    for (const entry of entries) {
      expect(entry.name.startsWith("/")).toBe(false);
    }
  });

  it("escribe los nombres acentuados en UTF-8 y marca la bandera correspondiente", () => {
    const name = "documentación/ñandú — año.txt";
    const [entry] = readArchive(
      createZip([{ name, data: Buffer.from("contenido", "utf8") }])
    );
    expect(entry.name).toBe(name);
    expect(entry.flags & FLAG_UTF8).toBe(FLAG_UTF8);
  });

  it("rechaza nombres duplicados, incluso tras normalizarlos", () => {
    expect(() =>
      createZip([
        { name: "contrato.md", data: Buffer.from("a", "utf8") },
        { name: "contrato.md", data: Buffer.from("b", "utf8") },
      ])
    ).toThrow(/entrada duplicada "contrato\.md"/);

    expect(() =>
      createZip([
        { name: "paquete/contrato.md", data: Buffer.from("a", "utf8") },
        { name: "/paquete//contrato.md", data: Buffer.from("b", "utf8") },
      ])
    ).toThrow(/entrada duplicada/);
  });

  it("rechaza nombres vacíos", () => {
    for (const name of ["", "   ", "/", "///"]) {
      expect(() => createZip([{ name, data: Buffer.from("a", "utf8") }])).toThrow(
        /no puede estar vacío/
      );
    }
  });

  it("rechaza las entradas de directorio", () => {
    for (const name of ["carpeta/", "paquete/evidencia/", "\\carpeta\\"]) {
      expect(() => createZip([{ name, data: Buffer.alloc(0) }])).toThrow(
        /no se admiten directorios/
      );
    }
  });

  it("rechaza los nombres con salidas de directorio", () => {
    for (const name of [
      "../fuera.txt",
      "..",
      "paquete/../../fuera.txt",
      "paquete/../contrato.md",
      "./contrato.md",
      "paquete/./contrato.md",
      "..\\fuera.txt",
    ]) {
      expect(() => createZip([{ name, data: Buffer.from("a", "utf8") }])).toThrow(
        /nombre de entrada inválido/
      );
    }
  });

  it("trata una entrada sin datos como archivo vacío", () => {
    const sinDatos = { name: "sin-datos.txt" } as unknown as ZipEntry;
    const [entry] = readArchive(createZip([sinDatos]));
    expect(entry.name).toBe("sin-datos.txt");
    expect(entry.method).toBe(METHOD_STORE);
    expect(entry.uncompressedSize).toBe(0);
    expect(entry.crc).toBe(0);
  });

  it("rechaza una entrada sin nombre", () => {
    const sinNombre = { data: Buffer.from("a", "utf8") } as unknown as ZipEntry;
    expect(() => createZip([sinNombre])).toThrow(/no puede estar vacío/);
  });

  it("rechaza una entrada cuyo contenido excede el límite de 4 GB", () => {
    const enorme = bufferConLongitudSimulada(3, 0xffffffff + 1);
    expect(() => createZip([{ name: "enorme.bin", data: enorme }])).toThrow(
      /la entrada "enorme\.bin" excede el límite de 4 GB/
    );
  });

  it("rechaza una entrada cuya carga útil excede el límite de 4 GB", () => {
    // El dato cabe, pero lo que se escribiría en el paquete no.
    const cargaEnorme = bufferConLongitudSimulada(4, 0xffffffff + 1);
    expect(() =>
      createZip([{ name: "carga/enorme.bin", data: cargaEnorme }])
    ).toThrow(/la entrada "carga\/enorme\.bin" excede el límite de 4 GB/);
  });

  it("rechaza el paquete cuyo desplazamiento acumulado excede 4 GB", () => {
    const casiLimite = bufferConLongitudSimulada(9, 0xffffffff);
    expect(() =>
      createZip([
        { name: "primero.txt", data: Buffer.from("uno", "utf8") },
        { name: "casi-limite.bin", data: casiLimite },
      ])
    ).toThrow(/el archivo excede el límite de 4 GB/);
  });

  it("no escribe ninguna entrada cuando una de ellas es inválida", () => {
    expect(() =>
      createZip([
        { name: "valido.txt", data: Buffer.from("a", "utf8") },
        { name: "../fuera.txt", data: Buffer.from("b", "utf8") },
      ])
    ).toThrow(/nombre de entrada inválido/);
  });

  it("produce un paquete que `unzip` valida y descomprime sin diferencias", async () => {
    const entries: ZipEntry[] = [
      { name: "contrato/texto.md", data: Buffer.from("# Contrato\n\nCláusula única.\n", "utf8") },
      { name: "manifiesto.json", data: Buffer.from(JSON.stringify({ version: 1 }), "utf8") },
      { name: "evidencia/vacio.txt", data: Buffer.alloc(0) },
      { name: "evidencia/repetido.txt", data: Buffer.from("evidencia ".repeat(500), "utf8") },
      { name: "evidencia/aleatorio.bin", data: randomBytes(2048) },
      { name: "documentación/ñandú.txt", data: Buffer.from("acentos áéíóú ñÑ\n", "utf8") },
    ];

    const directory = await temporaryDirectory();
    const archivePath = path.join(directory, "paquete.zip");
    await fs.writeFile(archivePath, createZip(entries));

    const report = execFileSync("unzip", ["-t", archivePath], { encoding: "utf8" });
    expect(report).toContain("No errors detected in compressed data");
    const tested = report
      .split("\n")
      .filter((row) => row.includes("testing:"))
      .map((row) => row.trim());
    expect(tested).toHaveLength(entries.length);
    for (const row of tested) {
      expect(row).toMatch(/\bOK$/);
    }

    const listing = execFileSync("unzip", ["-Z1", archivePath], { encoding: "utf8" });
    expect(listing.split("\n").filter(Boolean).sort()).toEqual(
      entries.map((entry) => entry.name).sort()
    );

    const extracted = path.join(directory, "salida");
    execFileSync("unzip", ["-qq", "-o", archivePath, "-d", extracted]);
    for (const entry of entries) {
      const restored = await fs.readFile(path.join(extracted, entry.name));
      expect(Buffer.compare(restored, entry.data)).toBe(0);
    }
  });
});
