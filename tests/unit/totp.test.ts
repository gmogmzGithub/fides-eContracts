import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTotpSecret,
  totpCode,
  totpUri,
  verifyTotp,
} from "@/lib/crypto/totp";

/** Secreto de los vectores del RFC 6238: ASCII "12345678901234567890". */
const SECRETO_RFC = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
/** Mismo largo que el anterior pero con el último carácter distinto. */
const OTRO_SECRETO = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJA";
const PASO_MS = 30_000;
const VECTORES_RFC: Array<[number, string]> = [
  [59, "287082"],
  [1_111_111_109, "081804"],
  [1_111_111_111, "050471"],
  [1_234_567_890, "005924"],
  [2_000_000_000, "279037"],
  [20_000_000_000, "353130"],
];

afterEach(() => {
  vi.useRealTimers();
});

describe("createTotpSecret", () => {
  it("devuelve 32 caracteres base32 para los 20 bytes por omisión", () => {
    const secret = createTotpSecret();
    expect(secret).toHaveLength(32);
    expect(secret).toMatch(/^[A-Z2-7]+$/u);
  });

  it("respeta el número de bytes solicitado", () => {
    expect(createTotpSecret(10)).toHaveLength(16);
    expect(createTotpSecret(5)).toHaveLength(8);
  });

  it("agrega el carácter final cuando los bits no son múltiplo de cinco", () => {
    expect(createTotpSecret(1)).toHaveLength(2);
    expect(createTotpSecret(2)).toHaveLength(4);
  });

  it("devuelve cadena vacía si se piden cero bytes", () => {
    expect(createTotpSecret(0)).toBe("");
  });

  it("genera secretos distintos en cada llamada", () => {
    const secretos = new Set(Array.from({ length: 50 }, () => createTotpSecret()));
    expect(secretos.size).toBe(50);
  });

  it("produce un secreto utilizable para generar y verificar códigos", () => {
    const secret = createTotpSecret();
    expect(verifyTotp(secret, totpCode(secret, 1_700_000_000_000), 1_700_000_000_000)).toBe(
      true
    );
  });
});

describe("totpCode contra los vectores del RFC 6238", () => {
  it.each(VECTORES_RFC)("en el segundo %i genera %s", (segundos, esperado) => {
    expect(totpCode(SECRETO_RFC, segundos * 1000)).toBe(esperado);
  });

  it("usa el reloj del sistema cuando no se pasa el instante", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(59_000));
    expect(totpCode(SECRETO_RFC)).toBe("287082");
  });

  it("mantiene el mismo código durante los treinta segundos del paso", () => {
    expect(totpCode(SECRETO_RFC, 30_000)).toBe(totpCode(SECRETO_RFC, 59_999));
    expect(totpCode(SECRETO_RFC, 60_000)).not.toBe(totpCode(SECRETO_RFC, 59_999));
  });

  it("siempre devuelve seis dígitos, incluso con ceros a la izquierda", () => {
    expect(totpCode(SECRETO_RFC, 1_234_567_890_000)).toBe("005924");
    for (let paso = 0; paso < 40; paso += 1) {
      expect(totpCode(SECRETO_RFC, paso * PASO_MS)).toMatch(/^\d{6}$/u);
    }
  });

  it("depende del secreto", () => {
    expect(totpCode(SECRETO_RFC, 59_000)).not.toBe(
      totpCode(OTRO_SECRETO, 59_000)
    );
  });
});

describe("totpCode y la decodificación base32", () => {
  it("acepta el secreto en minúsculas", () => {
    expect(totpCode(SECRETO_RFC.toLowerCase(), 59_000)).toBe("287082");
  });

  it("ignora el relleno con signos de igual", () => {
    expect(totpCode(`${SECRETO_RFC}====`, 59_000)).toBe("287082");
  });

  it("ignora espacios y guiones intercalados", () => {
    expect(totpCode("GEZD-GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ", 59_000)).toBe(
      "287082"
    );
  });

  it("hace ida y vuelta con un secreto generado por la propia función", () => {
    const secret = createTotpSecret(20);
    expect(secret.toUpperCase()).toBe(secret);
    expect(totpCode(secret, 59_000)).toBe(totpCode(secret.toLowerCase(), 59_000));
  });
});

describe("verifyTotp", () => {
  it("acepta el código del paso actual", () => {
    expect(verifyTotp(SECRETO_RFC, "287082", 59_000)).toBe(true);
  });

  it("acepta un paso de tolerancia hacia atrás", () => {
    const anterior = totpCode(SECRETO_RFC, 59_000 - PASO_MS);
    expect(verifyTotp(SECRETO_RFC, anterior, 59_000)).toBe(true);
  });

  it("acepta un paso de tolerancia hacia adelante", () => {
    const siguiente = totpCode(SECRETO_RFC, 59_000 + PASO_MS);
    expect(verifyTotp(SECRETO_RFC, siguiente, 59_000)).toBe(true);
  });

  it("rechaza dos pasos de distancia", () => {
    const base = 1_700_000_000_000;
    expect(
      verifyTotp(SECRETO_RFC, totpCode(SECRETO_RFC, base + 2 * PASO_MS), base)
    ).toBe(false);
    expect(
      verifyTotp(SECRETO_RFC, totpCode(SECRETO_RFC, base - 2 * PASO_MS), base)
    ).toBe(false);
  });

  it("usa el reloj del sistema cuando no se pasa el instante", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(59_000));
    expect(verifyTotp(SECRETO_RFC, "287082")).toBe(true);
  });

  it("rechaza el código de otro secreto", () => {
    expect(verifyTotp(OTRO_SECRETO, "287082", 59_000)).toBe(false);
  });

  it("verifica sin lanzar en el primer paso de la época Unix", () => {
    // El paso hacia atrás sería negativo y se descarta; el paso hacia adelante
    // sigue siendo válido, así que el código del segundo paso se acepta.
    expect(() => verifyTotp(SECRETO_RFC, "287082", 0)).not.toThrow();
    expect(verifyTotp(SECRETO_RFC, "287082", 0)).toBe(true);
    expect(verifyTotp(SECRETO_RFC, "000000", 0)).toBe(false);
  });

  it("descarta los separadores del código antes de compararlo", () => {
    expect(verifyTotp(SECRETO_RFC, "28 70 82", 59_000)).toBe(true);
    expect(verifyTotp(SECRETO_RFC, "287-082", 59_000)).toBe(true);
  });

  it("rechaza códigos con longitud distinta de seis dígitos", () => {
    expect(verifyTotp(SECRETO_RFC, "", 59_000)).toBe(false);
    expect(verifyTotp(SECRETO_RFC, "28708", 59_000)).toBe(false);
    expect(verifyTotp(SECRETO_RFC, "2870820", 59_000)).toBe(false);
    expect(verifyTotp(SECRETO_RFC, "abcdef", 59_000)).toBe(false);
  });

  it("rechaza un código de seis dígitos que no corresponde", () => {
    expect(verifyTotp(SECRETO_RFC, "000000", 59_000)).toBe(false);
    expect(verifyTotp(SECRETO_RFC, "287083", 59_000)).toBe(false);
  });
});

describe("totpUri", () => {
  it("arma el URI otpauth con el emisor por omisión", () => {
    expect(totpUri("ABCDEF", "persona@ejemplo.mx")).toBe(
      "otpauth://totp/Fides%3Apersona%40ejemplo.mx" +
        "?secret=ABCDEF&issuer=Fides&algorithm=SHA1&digits=6&period=30"
    );
  });

  it("permite personalizar el emisor en la etiqueta y en la consulta", () => {
    const uri = totpUri("ABCDEF", "persona@ejemplo.mx", "Otra Org");
    expect(uri).toContain("otpauth://totp/Otra%20Org%3Apersona%40ejemplo.mx");
    expect(uri).toContain("issuer=Otra+Org");
  });

  it("declara SHA1, seis dígitos y treinta segundos", () => {
    const query = new URL(totpUri("ABCDEF", "a@b.mx")).searchParams;
    expect(query.get("secret")).toBe("ABCDEF");
    expect(query.get("issuer")).toBe("Fides");
    expect(query.get("algorithm")).toBe("SHA1");
    expect(query.get("digits")).toBe("6");
    expect(query.get("period")).toBe("30");
  });

  it("escapa los caracteres especiales del correo en la etiqueta", () => {
    expect(totpUri("ABC", "a+b@ejemplo.mx")).toContain(
      "Fides%3Aa%2Bb%40ejemplo.mx"
    );
  });
});
