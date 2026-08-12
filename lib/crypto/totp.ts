import crypto from "crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD_SECONDS = 30;
const DIGITS = 6;

export function createTotpSecret(bytes = 20): string {
  return base32Encode(crypto.randomBytes(bytes));
}

export function totpUri(secret: string, email: string, issuer = "Fides"): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

export function totpCode(secret: string, atMs = Date.now()): string {
  return generate(secret, Math.floor(atMs / 1000 / PERIOD_SECONDS));
}

/** Acepta el paso actual y un paso de tolerancia hacia atrás y adelante. */
export function verifyTotp(secret: string, code: string, atMs = Date.now()): boolean {
  const normalized = code.replace(/\D/g, "");
  if (normalized.length !== DIGITS) return false;
  const counter = Math.floor(atMs / 1000 / PERIOD_SECONDS);
  for (const drift of [-1, 0, 1]) {
    // El contador nunca baja de cero: un paso negativo no existe en TOTP.
    const step = counter + drift;
    if (step < 0) continue;
    const candidate = generate(secret, step);
    if (
      candidate.length === normalized.length &&
      crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(normalized))
    ) {
      return true;
    }
  }
  return false;
}

function generate(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(secret: string): Buffer {
  const normalized = secret.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
