import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import {
  buildContext,
  createIssuableOrganization,
} from "@/tests/helpers/database";

/** Comprueba que el arnés de pruebas aísla datos entre casos. */
describe("arnés de pruebas", () => {
  it("crea una Organización lista para emitir", async () => {
    const fixture = await createIssuableOrganization();
    expect(fixture.context.organization.id).toBe(fixture.organization.id);
    expect(fixture.template.versionId).toBeTruthy();

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::TEXT AS count FROM organizations
    `;
    expect(count).toBe("1");
  });

  it("empieza cada prueba con la base vacía", async () => {
    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::TEXT AS count FROM organizations
    `;
    expect(count).toBe("0");
  });

  it("resuelve capacidades y valores predeterminados", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { ai_review: true, evidence_ine: true },
      defaults: { linkDays: 12, reviewPolicy: "manual", requiresIne: true },
    });
    const context = await buildContext(
      fixture.organization.id,
      fixture.account,
      ["administrator"]
    );
    expect(context.organization.capabilities.ai_review).toBe(true);
    expect(context.organization.capabilities.active_custody).toBe(false);
    expect(context.organization.defaults.linkDays).toBe(12);
    expect(context.organization.defaults.reviewPolicy).toBe("manual");
    expect(context.organization.defaults.requiresIne).toBe(true);
  });
});
