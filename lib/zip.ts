import { deflateRawSync } from "zlib";

/**
 * Escritor ZIP mínimo y determinista, sin dependencias externas.
 * El Paquete contractual frío se sella una sola vez y su hash debe poder
 * recalcularse: por eso la marca de tiempo interna es fija y las entradas se
 * escriben en el orden recibido.
 */

export interface ZipEntry {
  name: string;
  data: Buffer;
}

/** 2020-01-01 12:00:00 en formato MS-DOS, para que el archivo sea reproducible. */
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = (12 << 11) | (0 << 5) | 0;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const VERSION_MADE_BY = 0x031e; // UNIX, especificación 3.0
const VERSION_NEEDED = 20; // 2.0: deflate
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const MAX_32 = 0xffffffff;

const CRC_TABLE = buildCrcTable();

export function createZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  const seen = new Set<string>();
  let offset = 0;

  for (const entry of entries) {
    const name = normalizeName(entry.name);
    if (seen.has(name)) {
      throw new Error(`ZIP: entrada duplicada "${name}"`);
    }
    seen.add(name);

    const nameBytes = Buffer.from(name, "utf8");
    const data = entry.data ?? Buffer.alloc(0);
    const crc = crc32(data);

    let method = METHOD_STORE;
    let payload = data;
    if (data.length > 0) {
      const deflated = deflateRawSync(data, { level: 9 });
      if (deflated.length < data.length) {
        method = METHOD_DEFLATE;
        payload = deflated;
      }
    }

    if (data.length > MAX_32 || payload.length > MAX_32) {
      throw new Error(`ZIP: la entrada "${name}" excede el límite de 4 GB`);
    }

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(VERSION_MADE_BY, 4);
    central.writeUInt16LE(VERSION_NEEDED, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comentario
    central.writeUInt16LE(0, 34); // disco
    central.writeUInt16LE(0, 36); // atributos internos
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // atributos externos: archivo regular
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);

    locals.push(local, payload);
    centrals.push(central);
    offset += local.length + payload.length;

    if (offset > MAX_32) {
      throw new Error("ZIP: el archivo excede el límite de 4 GB");
    }
  }

  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centrals.length, 8);
  eocd.writeUInt16LE(centrals.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDirectory, eocd]);
}

/** Nombres relativos, con `/` y sin salidas del paquete. */
function normalizeName(raw: string): string {
  const name = String(raw ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/")
    .trim();
  if (!name) throw new Error("ZIP: el nombre de la entrada no puede estar vacío");
  if (name.endsWith("/")) throw new Error(`ZIP: no se admiten directorios ("${raw}")`);
  if (name.split("/").some((part) => part === "." || part === "..")) {
    throw new Error(`ZIP: nombre de entrada inválido ("${raw}")`);
  }
  return name;
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

/**
 * Comprobación manual (produce /tmp/zip-selfcheck.zip y lo valida con `unzip`):
 *
 *   cp lib/zip.ts /tmp/zip-selfcheck.mts && node --experimental-strip-types \
 *     --input-type=module -e 'import { createZip } from "/tmp/zip-selfcheck.mts";
 *     import { writeFileSync } from "fs";
 *     const e = [{ name: "contrato.md", data: Buffer.from("# Contrato\n") },
 *                { name: "manifiesto.json", data: Buffer.from("{}") }];
 *     const a = createZip(e);
 *     console.log("determinista:", Buffer.compare(a, createZip(e)) === 0);
 *     writeFileSync("/tmp/zip-selfcheck.zip", a);' \
 *   && unzip -l /tmp/zip-selfcheck.zip && unzip -t /tmp/zip-selfcheck.zip
 */
export function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
