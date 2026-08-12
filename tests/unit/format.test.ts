import { afterEach, describe, expect, it, vi } from "vitest";
import {
  daysUntil,
  formatBytes,
  formatDate,
  formatDateTime,
  formatMoney,
} from "@/lib/format";

afterEach(() => {
  vi.useRealTimers();
});

describe("formatDate", () => {
  it("formatea la fecha en español de México y zona horaria fija", () => {
    expect(formatDate(new Date("2026-08-01T15:00:00Z"))).toBe("01 ago 2026");
  });

  it("acepta la fecha como cadena ISO", () => {
    expect(formatDate("2026-01-05T06:30:00Z")).toBe("05 ene 2026");
  });

  it("usa la zona horaria de la Ciudad de México y no la del proceso", () => {
    // 2026-01-01T03:00:00Z todavía es 31 de diciembre en México.
    expect(formatDate("2026-01-01T03:00:00Z")).toBe("31 dic 2025");
  });

  it("devuelve un guion largo cuando no hay valor", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
  });

  it("devuelve Invalid Date cuando la cadena no es una fecha", () => {
    expect(formatDate("no-es-fecha")).toBe("Invalid Date");
  });
});

describe("formatDateTime", () => {
  it("agrega la hora y el minuto a la fecha", () => {
    const formatted = formatDateTime(new Date("2026-08-01T15:00:00Z"));
    expect(formatted).toMatch(/^01 ago 2026, 09:00\s?a\.m\.$/u);
  });

  it("acepta la fecha como cadena ISO", () => {
    const formatted = formatDateTime("2026-08-01T23:45:00Z");
    expect(formatted).toMatch(/^01 ago 2026, 05:45\s?p\.m\.$/u);
  });

  it("devuelve un guion largo cuando no hay valor", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatDateTime("")).toBe("—");
  });

  it("devuelve Invalid Date cuando la cadena no es una fecha", () => {
    expect(formatDateTime("no-es-fecha")).toBe("Invalid Date");
  });
});

describe("formatMoney", () => {
  it("formatea pesos mexicanos por omisión", () => {
    expect(formatMoney(1234.5)).toBe("$1,234.50");
  });

  it("acepta el importe como cadena numérica", () => {
    expect(formatMoney("1234.5")).toBe("$1,234.50");
  });

  it("formatea otras monedas con su código", () => {
    expect(formatMoney(1000, "USD")).toMatch(/^USD\s1,000\.00$/u);
  });

  it("formatea el cero y los importes negativos", () => {
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(-1)).toBe("-$1.00");
  });

  it("devuelve el valor original cuando no es un número finito", () => {
    expect(formatMoney("abc")).toBe("abc");
    expect(formatMoney("mil pesos")).toBe("mil pesos");
    expect(formatMoney(Number.NaN)).toBe("NaN");
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });

  it("trata la cadena vacía como cero porque Number('') es finito", () => {
    expect(formatMoney("")).toBe("$0.00");
  });
});

describe("formatBytes", () => {
  it("usa bytes por debajo de un kilobyte", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("usa kilobytes con un decimal hasta el megabyte", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024 - 1)).toBe("1024.0 KB");
  });

  it("usa megabytes con un decimal a partir del megabyte", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("daysUntil", () => {
  it("cuenta los días completos que faltan", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
    expect(daysUntil(new Date("2026-08-08T00:00:00Z"))).toBe(7);
  });

  it("redondea hacia arriba las fracciones de día", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
    expect(daysUntil(new Date("2026-08-01T00:00:01Z"))).toBe(1);
  });

  it("devuelve cero en el instante exacto de vencimiento", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
    expect(daysUntil(new Date("2026-08-01T00:00:00Z"))).toBe(0);
  });

  it("nunca devuelve valores negativos para fechas pasadas", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
    expect(daysUntil(new Date("2026-07-01T00:00:00Z"))).toBe(0);
  });

  it("acepta la fecha como cadena ISO", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
    expect(daysUntil("2026-08-04T00:00:00Z")).toBe(3);
  });
});
