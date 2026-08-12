import crypto from "crypto";

const KEY_LENGTH = 64;
const SCRYPT_COST = 16384;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto
    .scryptSync(password.normalize("NFKC"), salt, KEY_LENGTH, { N: SCRYPT_COST })
    .toString("hex");
  return `scrypt$${SCRYPT_COST}$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, cost, salt, digest] = stored.split("$");
  if (scheme !== "scrypt" || !cost || !salt || !digest) return false;
  const derived = crypto.scryptSync(
    password.normalize("NFKC"),
    salt,
    KEY_LENGTH,
    { N: Number(cost) }
  );
  const expected = Buffer.from(digest, "hex");
  if (expected.length !== derived.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}
