import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import {
  formatReference,
  nextReference,
  referenceDay,
} from "@/lib/domain/reference";
import { createOrganization } from "@/tests/helpers/database";

const REFERENCE_PATTERN = /^AC-\d{8}-\d{4}$/;

/** Día operativo esperado en la zona horaria del piloto. */
const MEXICO_CITY_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

async function reference(organizationId: string): Promise<string> {
  return sql.begin((tx) => nextReference(tx, organizationId));
}

describe("día operativo de la referencia", () => {
  it("entrega el día como `YYYY-MM-DD` en la zona del piloto", () => {
    expect(referenceDay(new Date("2026-08-01T18:00:00.000Z"))).toBe("2026-08-01");
    expect(referenceDay(new Date("2026-01-31T12:00:00.000Z"))).toBe("2026-01-31");
  });

  it("usa la hora de Ciudad de México, no UTC, en el cambio de día", () => {
    // 04:00 UTC del 1 de agosto es 22:00 del 31 de julio en Ciudad de México.
    expect(referenceDay(new Date("2026-08-01T04:00:00.000Z"))).toBe("2026-07-31");
    // 06:00 UTC ya es el 1 de agosto a las 00:00 locales.
    expect(referenceDay(new Date("2026-08-01T06:00:00.000Z"))).toBe("2026-08-01");
  });

  it("usa el momento actual cuando no recibe una fecha", () => {
    const day = referenceDay();
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(day).toBe(MEXICO_CITY_DAY.format(new Date()));
  });
});

describe("formato de la referencia", () => {
  it("arma `AC-YYYYMMDD-NNNN` sin guiones en el día", () => {
    expect(formatReference("2026-08-01", 1)).toBe("AC-20260801-0001");
    expect(formatReference("2026-12-31", 42)).toBe("AC-20261231-0042");
    expect(formatReference("2026-01-02", 9999)).toBe("AC-20260102-9999");
  });

  it("rellena el consecutivo a cuatro dígitos", () => {
    expect(formatReference("2026-08-01", 0)).toBe("AC-20260801-0000");
    expect(formatReference("2026-08-01", 7)).toBe("AC-20260801-0007");
    expect(formatReference("2026-08-01", 123)).toBe("AC-20260801-0123");
  });

  it("no recorta un consecutivo de más de cuatro dígitos", () => {
    expect(formatReference("2026-08-01", 12345)).toBe("AC-20260801-12345");
  });
});

describe("secuencia de referencias contractuales", () => {
  it("entrega la primera referencia del día con el formato acordado", async () => {
    const organization = await createOrganization();

    const first = await reference(organization.id);

    expect(first).toMatch(REFERENCE_PATTERN);
    expect(first).toBe(formatReference(referenceDay(), 1));
    expect(first.endsWith("-0001")).toBe(true);
  });

  it("incrementa el consecutivo en la misma Organización y el mismo día", async () => {
    const organization = await createOrganization();

    const emitted: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      emitted.push(await reference(organization.id));
    }

    const day = referenceDay();
    expect(emitted).toEqual([
      formatReference(day, 1),
      formatReference(day, 2),
      formatReference(day, 3),
    ]);
  });

  it("guarda una sola fila de secuencia por Organización y día", async () => {
    const organization = await createOrganization();
    await reference(organization.id);
    await reference(organization.id);

    const rows = await sql<{ day: string; last_value: number }[]>`
      SELECT day::TEXT AS day, last_value
      FROM contract_reference_sequences
      WHERE organization_id = ${organization.id}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].day).toBe(referenceDay());
    expect(rows[0].last_value).toBe(2);
  });

  it("da a cada Organización su propia secuencia el mismo día", async () => {
    const primera = await createOrganization();
    const segunda = await createOrganization();

    const primeraUno = await reference(primera.id);
    const primeraDos = await reference(primera.id);
    const segundaUno = await reference(segunda.id);

    const day = referenceDay();
    expect(primeraUno).toBe(formatReference(day, 1));
    expect(primeraDos).toBe(formatReference(day, 2));
    // La otra Organización empieza en 0001 aunque compartan el día.
    expect(segundaUno).toBe(formatReference(day, 1));
    expect(primeraUno).toBe(segundaUno);
  });

  it("reinicia el consecutivo en un día distinto de la misma Organización", async () => {
    const organization = await createOrganization();
    await sql`
      INSERT INTO contract_reference_sequences (organization_id, day, last_value)
      VALUES (${organization.id}, ${"2020-01-01"}::date, 87)
    `;

    expect(await reference(organization.id)).toBe(
      formatReference(referenceDay(), 1)
    );

    const rows = await sql<{ day: string; last_value: number }[]>`
      SELECT day::TEXT AS day, last_value
      FROM contract_reference_sequences
      WHERE organization_id = ${organization.id}
      ORDER BY day
    `;
    expect(rows).toEqual([
      { day: "2020-01-01", last_value: 87 },
      { day: referenceDay(), last_value: 1 },
    ]);
  });

  it("nunca repite un consecutivo con emisiones simultáneas", async () => {
    const organization = await createOrganization();
    const total = 8;

    const emitted = await Promise.all(
      Array.from({ length: total }, () => reference(organization.id))
    );

    expect(emitted).toHaveLength(total);
    expect(new Set(emitted).size).toBe(total);
    for (const value of emitted) expect(value).toMatch(REFERENCE_PATTERN);

    const day = referenceDay();
    expect([...emitted].sort()).toEqual(
      Array.from({ length: total }, (_, index) =>
        formatReference(day, index + 1)
      )
    );

    const [row] = await sql<{ last_value: number }[]>`
      SELECT last_value FROM contract_reference_sequences
      WHERE organization_id = ${organization.id}
    `;
    expect(row.last_value).toBe(total);
  });

  it("no mezcla consecutivos simultáneos entre Organizaciones", async () => {
    const primera = await createOrganization();
    const segunda = await createOrganization();

    const emitted = await Promise.all([
      reference(primera.id),
      reference(segunda.id),
      reference(primera.id),
      reference(segunda.id),
    ]);

    const day = referenceDay();
    const esperado = [formatReference(day, 1), formatReference(day, 2)];
    expect([emitted[0], emitted[2]].sort()).toEqual(esperado);
    expect([emitted[1], emitted[3]].sort()).toEqual(esperado);
  });
});
