import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  ObjectStorage,
  PutObjectInput,
  StoredObjectContent,
  StoredObjectLocation,
} from "@/lib/storage/object-storage";

interface LocalObjectMetadata {
  contentType: string;
  size: number;
  eTag?: string;
  metadata: Record<string, string>;
}

const DEFAULT_LOCAL_ROOT = path.join(
  os.tmpdir(),
  "fides-object-storage"
);

export class LocalObjectStorage implements ObjectStorage {
  readonly provider = "local" as const;
  readonly bucket = "fides-local";

  constructor(
    private readonly root =
      process.env.FIDES_OBJECT_DIR ?? DEFAULT_LOCAL_ROOT
  ) {}

  async put(input: PutObjectInput): Promise<StoredObjectLocation> {
    const objectPath = this.resolveKey(input.key);
    const metadataPath = this.metadataPath(objectPath);
    await fs.mkdir(path.dirname(objectPath), { recursive: true });

    const objectTemporary = `${objectPath}.${process.pid}.tmp`;
    const metadataTemporary = `${metadataPath}.${process.pid}.tmp`;
    const metadata: LocalObjectMetadata = {
      contentType: input.contentType,
      size: input.body.byteLength,
      metadata: input.metadata ?? {},
    };

    await fs.writeFile(objectTemporary, input.body, { mode: 0o600 });
    await fs.writeFile(metadataTemporary, JSON.stringify(metadata), {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(objectTemporary, objectPath);
    await fs.rename(metadataTemporary, metadataPath);

    return {
      provider: this.provider,
      bucket: this.bucket,
      key: input.key,
      contentType: metadata.contentType,
      size: metadata.size,
    };
  }

  async get(key: string): Promise<StoredObjectContent> {
    const objectPath = this.resolveKey(key);
    const [body, metadata] = await Promise.all([
      fs.readFile(objectPath),
      this.readMetadata(objectPath),
    ]);
    return {
      provider: this.provider,
      bucket: this.bucket,
      key,
      body,
      contentType: metadata.contentType,
      size: body.byteLength,
      eTag: metadata.eTag,
      metadata: metadata.metadata,
    };
  }

  async head(key: string): Promise<StoredObjectLocation | null> {
    const objectPath = this.resolveKey(key);
    try {
      const [stat, metadata] = await Promise.all([
        fs.stat(objectPath),
        this.readMetadata(objectPath),
      ]);
      return {
        provider: this.provider,
        bucket: this.bucket,
        key,
        contentType: metadata.contentType,
        size: stat.size,
        eTag: metadata.eTag,
      };
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const objectPath = this.resolveKey(key);
    await Promise.all([
      fs.rm(objectPath, { force: true }),
      fs.rm(this.metadataPath(objectPath), { force: true }),
    ]);
  }

  private resolveKey(key: string): string {
    if (
      !key ||
      key.includes("\\") ||
      key.includes("\0") ||
      path.posix.isAbsolute(key)
    ) {
      throw new Error("La clave del objeto no es válida.");
    }
    const normalized = path.posix.normalize(key);
    if (normalized === ".." || normalized.startsWith("../")) {
      throw new Error("La clave del objeto sale del directorio autorizado.");
    }
    // `.` y `org/..` apuntan a la raíz: no son objetos válidos.
    if (normalized === "." || normalized === "./") {
      throw new Error("La clave del objeto no es válida.");
    }
    const resolvedRoot = path.resolve(this.root);
    const resolvedObject = path.resolve(resolvedRoot, normalized);
    // Defensa final: las comprobaciones anteriores ya rechazan la clave
    // absoluta, la que sube con `..` y la que apunta a la raíz, así que esta
    // rama no es alcanzable; se conserva por si cambia la normalización.
    /* v8 ignore next 6 -- comprobación redundante tras normalizar la clave */
    if (
      resolvedObject !== resolvedRoot &&
      !resolvedObject.startsWith(`${resolvedRoot}${path.sep}`)
    ) {
      throw new Error("La clave del objeto sale del directorio autorizado.");
    }
    return resolvedObject;
  }

  private metadataPath(objectPath: string): string {
    return `${objectPath}.fides-metadata.json`;
  }

  private async readMetadata(objectPath: string): Promise<LocalObjectMetadata> {
    return JSON.parse(
      await fs.readFile(this.metadataPath(objectPath), "utf8")
    ) as LocalObjectMetadata;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
