import crypto from "crypto";

/** Token opaco de alta entropía para enlaces, sesiones e invitaciones. */
export function createOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** Sólo el hash del token vive en PostgreSQL. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function sha256Hex(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
