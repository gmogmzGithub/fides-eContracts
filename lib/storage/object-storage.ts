export type ObjectStorageProvider = "local" | "r2";

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface StoredObjectLocation {
  provider: ObjectStorageProvider;
  bucket: string;
  key: string;
  contentType: string;
  size: number;
  eTag?: string;
}

export interface StoredObjectContent extends StoredObjectLocation {
  body: Buffer;
  metadata: Record<string, string>;
}

export interface ObjectStorage {
  readonly provider: ObjectStorageProvider;
  readonly bucket: string;
  put(input: PutObjectInput): Promise<StoredObjectLocation>;
  get(key: string): Promise<StoredObjectContent>;
  head(key: string): Promise<StoredObjectLocation | null>;
  delete(key: string): Promise<void>;
}

export class ObjectStorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectStorageConfigurationError";
  }
}

export class ObjectStorageIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectStorageIntegrityError";
  }
}
