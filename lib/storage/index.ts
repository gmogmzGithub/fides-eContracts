import "server-only";
import { LocalObjectStorage } from "@/lib/storage/local-object-storage";
import type { ObjectStorage } from "@/lib/storage/object-storage";

let storage: ObjectStorage | undefined;

/**
 * Almacenamiento privado de objetos. La versión local usa un directorio
 * montado; la operación real sustituirá el adaptador por S3 privado.
 */
export function getObjectStorage(): ObjectStorage {
  if (!storage) storage = new LocalObjectStorage();
  return storage;
}

export function resetObjectStorageForTests(): void {
  storage = undefined;
}

export * from "@/lib/storage/object-storage";
