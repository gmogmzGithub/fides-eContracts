import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import type { OrganizationContext } from "@/lib/auth/guards";
import { cancelContract } from "@/lib/domain/contracts";
import { createDraft, issueContract, saveDraft } from "@/lib/domain/drafts";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from "@/lib/domain/errors";
import {
  concludeAndAccept,
  getReviewTask,
  listReviewTasks,
  recordExternalContact,
  repeatProcess,
  saveAiReport,
  skipAndAccept,
} from "@/lib/domain/review";
import {
  acceptContract,
  loadSignerView,
  markContractWalked,
  storeEvidence,
} from "@/lib/domain/signer";
import {
  REPEAT_REASON_LABELS,
  type OrganizationRole,
  type RepeatReasonCode,
  type ReviewPolicy,
} from "@/lib/domain/types";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  addMembership,
  buildContext,
  createAccount,
  createIssuableOrganization,
  type AccountFixture,
} from "@/tests/helpers/database";

// ---------------------------------------------------------------------------
// Arnés: se llega a `A revisión` siempre por el camino real
// Borrador -> Generar enlace -> recorrido del Firmante -> Aceptar contrato.
// ---------------------------------------------------------------------------

const INE_FRONT = {
  buffer: Buffer.from("ine-frente-sintetica"),
  contentType: "image/png",
  fileName: "ine-frente.png",
};
const INE_BACK = {
  buffer: Buffer.from("ine-reverso-sintetica"),
  contentType: "image/png",
  fileName: "ine-reverso.png",
};
const VIDEO = {
  buffer: Buffer.from("video-guiado-sintetico"),
  contentType: "video/webm",
  fileName: "video.webm",
};

interface Member {
  account: AccountFixture;
  context: OrganizationContext;
}

interface SubmittedAttempt {
  contractId: string;
  reference: string;
  token: string;
  attemptId: string;
  taskId: string;
}

interface ScenarioOptions {
  reviewPolicy?: ReviewPolicy;
  requiresIne?: boolean;
  requiresVideo?: boolean;
}

type IssuableFixture = Awaited<ReturnType<typeof createIssuableOrganization>>;

interface Scenario extends SubmittedAttempt {
  fixture: IssuableFixture;
  organizationId: string;
  organizationName: string;
  reviewer: Member;
  addMember: (roles: OrganizationRole[]) => Promise<Member>;
  issue: () => Promise<{ contractId: string; token: string }>;
  submit: (token: string) => Promise<SubmittedAttempt>;
  issueAndSubmit: () => Promise<SubmittedAttempt>;
}

async function memberOf(
  organizationId: string,
  roles: OrganizationRole[]
): Promise<Member> {
  const account = await createAccount();
  await addMembership(organizationId, account.id, roles);
  return { account, context: await buildContext(organizationId, account, roles) };
}

async function locateTask(token: string): Promise<SubmittedAttempt> {
  const [row] = await sql<
    {
      task_id: string;
      attempt_id: string;
      contract_id: string;
      reference: string;
    }[]
  >`
    SELECT t.id AS task_id, t.attempt_id, t.contract_id, c.reference
    FROM contract_links l
    JOIN review_tasks t ON t.attempt_id = l.attempt_id
    JOIN contracts c ON c.id = t.contract_id
    WHERE l.token = ${token}
  `;
  return {
    taskId: row.task_id,
    attemptId: row.attempt_id,
    contractId: row.contract_id,
    reference: row.reference,
    token,
  };
}

async function prepareScenario(
  options: ScenarioOptions = {}
): Promise<Scenario> {
  const reviewPolicy = options.reviewPolicy ?? "manual";
  const requiresIne = options.requiresIne ?? false;
  const requiresVideo = options.requiresVideo ?? false;

  const fixture = await createIssuableOrganization({
    capabilities: {
      ai_review: true,
      evidence_ine: requiresIne,
      evidence_video: requiresVideo,
    },
    defaults: { reviewPolicy, requiresIne, requiresVideo },
  });

  const issue = async (): Promise<{ contractId: string; token: string }> => {
    const draftId = await createDraft(fixture.context, {
      templateId: fixture.template.id,
    });
    await saveDraft(fixture.context, draftId, {
      holderId: fixture.holder.id,
      signerId: fixture.signer.id,
      fieldValues: { objeto: "Servicio sintético de prueba", monto: "1500" },
    });
    const issued = await issueContract(fixture.context, draftId);
    return { contractId: issued.contractId, token: issued.token };
  };

  const submit = async (token: string): Promise<SubmittedAttempt> => {
    const view = await loadSignerView(token);
    expect(view.ok).toBe(true);
    await markContractWalked(token);
    if (requiresIne) {
      await storeEvidence(token, "ine_front", INE_FRONT);
      await storeEvidence(token, "ine_back", INE_BACK);
    }
    if (requiresVideo) {
      await storeEvidence(token, "video", VIDEO, { recordedInSession: true });
    }
    const result = await acceptContract(token, {
      legendAccepted: true,
      declaredName: fixture.signer.name,
      userAgent: "vitest",
    });
    expect(result.result).toBe("in_review");
    return locateTask(token);
  };

  const issueAndSubmit = async (): Promise<SubmittedAttempt> => {
    const issued = await issue();
    return submit(issued.token);
  };

  const first = await issueAndSubmit();
  const reviewer = await memberOf(fixture.organization.id, ["reviewer"]);

  return {
    ...first,
    fixture,
    organizationId: fixture.organization.id,
    organizationName: fixture.organization.name,
    reviewer,
    addMember: (roles) => memberOf(fixture.organization.id, roles),
    issue,
    submit,
    issueAndSubmit,
  };
}

async function contractStatus(contractId: string): Promise<string> {
  const [row] = await sql<{ status: string }[]>`
    SELECT status FROM contracts WHERE id = ${contractId}
  `;
  return row.status;
}

async function countDecisions(contractId: string): Promise<number> {
  const [row] = await sql<{ total: string }[]>`
    SELECT COUNT(*)::text AS total FROM review_decisions
    WHERE contract_id = ${contractId}
  `;
  return Number(row.total);
}

async function countAttempts(contractId: string): Promise<number> {
  const [row] = await sql<{ total: string }[]>`
    SELECT COUNT(*)::text AS total FROM acceptance_attempts
    WHERE contract_id = ${contractId}
  `;
  return Number(row.total);
}

async function countSealJobs(contractId: string): Promise<number> {
  const [row] = await sql<{ total: string }[]>`
    SELECT COUNT(*)::text AS total FROM background_jobs
    WHERE kind = 'seal_cold_package'
      AND payload->>'contractId' = ${contractId}
  `;
  return Number(row.total);
}

// ---------------------------------------------------------------------------
// listReviewTasks
// ---------------------------------------------------------------------------

describe("listReviewTasks", () => {
  it("comparte la bandeja entre todos los Revisores de la Organización", async () => {
    const scenario = await prepareScenario();
    const otro = await scenario.addMember(["reviewer"]);

    const primera = await listReviewTasks(scenario.reviewer.context);
    const segunda = await listReviewTasks(otro.context);

    expect(primera.rows).toHaveLength(1);
    expect(primera.rows[0].taskId).toBe(scenario.taskId);
    expect(segunda.rows.map((row) => row.taskId)).toEqual(
      primera.rows.map((row) => row.taskId)
    );
    expect(primera.total).toBe(1);
    expect(primera.pages).toBe(1);
    expect(primera.page).toBe(1);
  });

  it("entrega los datos operativos de cada Intento a revisión", async () => {
    const scenario = await prepareScenario();
    const { rows } = await listReviewTasks(scenario.reviewer.context);
    const row = rows[0];

    expect(row.contractId).toBe(scenario.contractId);
    expect(row.reference).toBe(scenario.reference);
    expect(row.attemptId).toBe(scenario.attemptId);
    expect(row.sequence).toBe(1);
    expect(row.templateName).toBe(scenario.fixture.template.name);
    expect(row.holderName).toBe(scenario.fixture.holder.name);
    expect(row.signerName).toBe(scenario.fixture.signer.name);
    expect(row.submittedAt).toBeInstanceOf(Date);
    expect(row.aiRecommendation).toBeNull();
  });

  it("muestra la recomendación del reporte AI más reciente", async () => {
    const scenario = await prepareScenario({ reviewPolicy: "ai" });
    await saveAiReport({
      contractId: scenario.contractId,
      attemptId: scenario.attemptId,
      model: "doble-local",
      configurationVersion: "1",
      status: "completed",
      recommendation: "accept",
    });

    const { rows } = await listReviewTasks(scenario.reviewer.context);
    expect(rows[0].aiRecommendation).toBe("accept");
  });

  it("pagina de veinte en veinte", async () => {
    const scenario = await prepareScenario();
    for (let index = 0; index < 20; index += 1) {
      await scenario.issueAndSubmit();
    }

    const primera = await listReviewTasks(scenario.reviewer.context, 1);
    expect(primera.total).toBe(21);
    expect(primera.rows).toHaveLength(20);
    expect(primera.pages).toBe(2);

    const segunda = await listReviewTasks(scenario.reviewer.context, 2);
    expect(segunda.rows).toHaveLength(1);
    expect(segunda.page).toBe(2);

    const identificadores = new Set([
      ...primera.rows.map((row) => row.taskId),
      ...segunda.rows.map((row) => row.taskId),
    ]);
    expect(identificadores.size).toBe(21);

    const tercera = await listReviewTasks(scenario.reviewer.context, 3);
    expect(tercera.rows).toHaveLength(0);
    expect(tercera.total).toBe(21);
  });

  it("normaliza una página inválida a la primera", async () => {
    const scenario = await prepareScenario();
    for (const page of [0, -5, 1.9]) {
      const result = await listReviewTasks(scenario.reviewer.context, page);
      expect(result.page).toBe(1);
      expect(result.rows).toHaveLength(1);
    }
  });

  it("ordena por antigüedad del envío y deja al final los sin fecha", async () => {
    const scenario = await prepareScenario();
    const segundo = await scenario.issueAndSubmit();
    const tercero = await scenario.issueAndSubmit();

    await sql`
      UPDATE acceptance_attempts SET submitted_at = '2026-01-03T10:00:00Z'
      WHERE id = ${scenario.attemptId}
    `;
    await sql`
      UPDATE acceptance_attempts SET submitted_at = '2026-01-01T10:00:00Z'
      WHERE id = ${segundo.attemptId}
    `;
    await sql`
      UPDATE acceptance_attempts SET submitted_at = NULL
      WHERE id = ${tercero.attemptId}
    `;

    const { rows } = await listReviewTasks(scenario.reviewer.context);
    expect(rows.map((row) => row.taskId)).toEqual([
      segundo.taskId,
      scenario.taskId,
      tercero.taskId,
    ]);
    expect(rows[2].submittedAt.getTime()).toBe(0);
  });

  it("devuelve cadenas vacías cuando el expediente no conserva partes", async () => {
    const scenario = await prepareScenario();
    await sql`DELETE FROM contract_parties WHERE contract_id = ${scenario.contractId}`;

    const { rows } = await listReviewTasks(scenario.reviewer.context);
    expect(rows[0].holderName).toBe("");
    expect(rows[0].signerName).toBe("");
  });

  it("nunca cruza Organizaciones", async () => {
    const propia = await prepareScenario();
    const ajena = await prepareScenario();

    const { rows, total } = await listReviewTasks(propia.reviewer.context);
    expect(total).toBe(1);
    expect(rows.map((row) => row.taskId)).not.toContain(ajena.taskId);
  });

  it("oculta los Contratos con Clasificación operativa Eliminado", async () => {
    const scenario = await prepareScenario();
    await sql`
      UPDATE contracts SET classification = 'deleted', deleted_at = NOW()
      WHERE id = ${scenario.contractId}
    `;

    const result = await listReviewTasks(scenario.reviewer.context);
    expect(result.total).toBe(0);
    expect(result.rows).toHaveLength(0);
    expect(result.pages).toBe(1);
  });

  it("admite al Administrador y rechaza a una cuenta sólo Emisora", async () => {
    const scenario = await prepareScenario();
    const administrador = await scenario.addMember(["administrator"]);
    const emisor = await scenario.addMember(["emitter"]);

    await expect(
      listReviewTasks(administrador.context)
    ).resolves.toMatchObject({ total: 1 });
    await expect(listReviewTasks(emisor.context)).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });
});

// ---------------------------------------------------------------------------
// getReviewTask
// ---------------------------------------------------------------------------

describe("getReviewTask", () => {
  it("presenta el Contrato, el Perfil de evidencia efectivo y la evidencia del intento", async () => {
    const scenario = await prepareScenario({
      requiresIne: true,
      requiresVideo: true,
    });
    const detail = await getReviewTask(
      scenario.reviewer.context,
      scenario.taskId
    );

    expect(detail.status).toBe("open");
    expect(detail.contractId).toBe(scenario.contractId);
    expect(detail.reference).toBe(scenario.reference);
    expect(detail.organizationName).toBe(scenario.organizationName);
    expect(detail.attemptId).toBe(scenario.attemptId);
    expect(detail.sequence).toBe(1);
    expect(detail.templateName).toBe(scenario.fixture.template.name);
    expect(detail.holderName).toBe(scenario.fixture.holder.name);
    expect(detail.signerName).toBe(scenario.fixture.signer.name);
    expect(detail.contractMarkdown).toContain("Servicio sintético de prueba");
    expect(detail.acceptanceLegend).toContain("Aceptar contrato");
    expect(detail.videoStatement).not.toContain(scenario.reference);
    expect(detail.videoStatement).toContain("$1,500.00");
    expect(detail.reviewPolicy).toBe("manual");
    expect(detail.requiresIne).toBe(true);
    expect(detail.requiresVideo).toBe(true);
    expect(detail.submittedAt).toBeInstanceOf(Date);

    expect(detail.evidence.map((item) => item.kind)).toEqual([
      "acceptance",
      "ine_back",
      "ine_front",
      "video",
    ]);
    const video = detail.evidence.find((item) => item.kind === "video");
    expect(video?.contentType).toBe("video/webm");
    expect(video?.byteSize).toBe(VIDEO.buffer.byteLength);
    expect(video?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(video?.metadata.fileName).toBe(VIDEO.fileName);
    expect(video?.createdAt).toBeInstanceOf(Date);
  });

  it("devuelve cadenas vacías cuando el expediente no conserva partes", async () => {
    const scenario = await prepareScenario();
    await sql`DELETE FROM contract_parties WHERE contract_id = ${scenario.contractId}`;

    const detail = await getReviewTask(
      scenario.reviewer.context,
      scenario.taskId
    );
    expect(detail.holderName).toBe("");
    expect(detail.signerName).toBe("");
    // El resto de la revisión sigue siendo utilizable.
    expect(detail.reference).toBe(scenario.reference);
    expect(detail.canDecide).toBe(true);
  });

  it("sólo entrega el localizador del objeto a quien puede abrir evidencia sensible", async () => {
    const scenario = await prepareScenario({ requiresIne: true });
    const administrador = await scenario.addMember(["administrator"]);
    const emisor = await scenario.addMember(["emitter"]);

    const paraRevisor = await getReviewTask(
      scenario.reviewer.context,
      scenario.taskId
    );
    expect(paraRevisor.canOpenEvidence).toBe(true);
    expect(
      paraRevisor.evidence.find((item) => item.kind === "ine_front")?.objectKey
    ).toContain(`attempts/${scenario.attemptId}/ine_front-`);

    const paraAdministrador = await getReviewTask(
      administrador.context,
      scenario.taskId
    );
    expect(paraAdministrador.canOpenEvidence).toBe(true);

    // Una cuenta sólo Emisora ni siquiera abre la tarea de revisión.
    await expect(
      getReviewTask(emisor.context, scenario.taskId)
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("habilita la decisión sólo al Revisor con la tarea abierta", async () => {
    const scenario = await prepareScenario();
    const administrador = await scenario.addMember(["administrator"]);

    const revisor = await getReviewTask(
      scenario.reviewer.context,
      scenario.taskId
    );
    expect(revisor.canDecide).toBe(true);

    const admin = await getReviewTask(administrador.context, scenario.taskId);
    expect(admin.canDecide).toBe(false);

    await concludeAndAccept(scenario.reviewer.context, scenario.taskId);
    const resuelta = await getReviewTask(
      scenario.reviewer.context,
      scenario.taskId
    );
    expect(resuelta.status).toBe("resolved");
    expect(resuelta.canDecide).toBe(false);
  });

  it("incluye el Reporte de revisión por AI cuando existe", async () => {
    const scenario = await prepareScenario({ reviewPolicy: "ai" });
    await saveAiReport({
      contractId: scenario.contractId,
      attemptId: scenario.attemptId,
      model: "doble-local-1",
      configurationVersion: "cfg-7",
      status: "completed",
      transcript: "Soy la persona firmante y acepto el contrato.",
      expectedStatement: "Declaración esperada.",
      findings: [{ codigo: "audio_ok" }],
      confidence: 0.812,
      limitations: "No verifica identidad.",
      recommendation: "accept",
    });

    const detail = await getReviewTask(
      scenario.reviewer.context,
      scenario.taskId
    );
    expect(detail.aiReport).not.toBeNull();
    expect(detail.aiReport?.model).toBe("doble-local-1");
    expect(detail.aiReport?.configurationVersion).toBe("cfg-7");
    expect(detail.aiReport?.status).toBe("completed");
    expect(detail.aiReport?.transcript).toContain("acepto el contrato");
    expect(detail.aiReport?.expectedStatement).toBe("Declaración esperada.");
    expect(detail.aiReport?.findings).toEqual([{ codigo: "audio_ok" }]);
    expect(detail.aiReport?.confidence).toBeCloseTo(0.812, 3);
    expect(detail.aiReport?.limitations).toBe("No verifica identidad.");
    expect(detail.aiReport?.recommendation).toBe("accept");
    expect(detail.aiReport?.createdAt).toBeInstanceOf(Date);
  });

  it("entrega el reporte más reciente y tolera confianza nula o hallazgos no listados", async () => {
    const scenario = await prepareScenario({ reviewPolicy: "ai" });
    await saveAiReport({
      contractId: scenario.contractId,
      attemptId: scenario.attemptId,
      model: "primero",
      configurationVersion: "1",
      status: "completed",
      recommendation: "inconclusive",
    });
    await sql`
      INSERT INTO ai_review_reports (
        attempt_id, contract_id, organization_id, model, configuration_version,
        status, findings, confidence, recommendation, created_at
      ) VALUES (
        ${scenario.attemptId}, ${scenario.contractId}, ${scenario.organizationId},
        'segundo', '2', 'failed', '{"no":"es-lista"}'::jsonb, NULL, NULL,
        NOW() + INTERVAL '1 minute'
      )
    `;

    const detail = await getReviewTask(
      scenario.reviewer.context,
      scenario.taskId
    );
    expect(detail.aiReport?.model).toBe("segundo");
    expect(detail.aiReport?.confidence).toBeNull();
    expect(detail.aiReport?.findings).toEqual([]);
    expect(detail.aiReport?.recommendation).toBeNull();
  });

  it("deja el Reporte AI en nulo cuando la revisión es manual", async () => {
    const scenario = await prepareScenario();
    const detail = await getReviewTask(
      scenario.reviewer.context,
      scenario.taskId
    );
    expect(detail.aiReport).toBeNull();
    expect(detail.history).toEqual([]);
    expect(detail.decision).toBeNull();
  });

  it("conserva el historial sencillo de las repeticiones anteriores", async () => {
    const scenario = await prepareScenario();
    const repeticion = await repeatProcess(
      scenario.reviewer.context,
      scenario.taskId,
      "ine_ilegible"
    );
    const sucesor = await scenario.submit(repeticion.token);

    const detalleSucesor = await getReviewTask(
      scenario.reviewer.context,
      sucesor.taskId
    );
    expect(detalleSucesor.sequence).toBe(2);
    expect(detalleSucesor.decision).toBeNull();
    expect(detalleSucesor.history).toHaveLength(1);
    expect(detalleSucesor.history[0]).toMatchObject({
      taskId: scenario.taskId,
      attemptId: scenario.attemptId,
      decision: "repeat",
      reviewerName: scenario.reviewer.account.fullName,
      reasonCode: "ine_ilegible",
      reasonText: null,
      successorAttemptId: sucesor.attemptId,
    });
    expect(detalleSucesor.history[0].createdAt).toBeInstanceOf(Date);

    // La tarea repetida conserva su propia decisión fuera del historial.
    const detalleAnterior = await getReviewTask(
      scenario.reviewer.context,
      scenario.taskId
    );
    expect(detalleAnterior.decision?.decision).toBe("repeat");
    expect(detalleAnterior.history).toHaveLength(0);
  });

  it("no encuentra la tarea de otra Organización ni un identificador desconocido", async () => {
    const propia = await prepareScenario();
    const ajena = await prepareScenario();

    await expect(
      getReviewTask(propia.reviewer.context, ajena.taskId)
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getReviewTask(
        propia.reviewer.context,
        "00000000-0000-4000-8000-000000000000"
      )
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rechaza a una cuenta sólo Emisora", async () => {
    const scenario = await prepareScenario();
    const emisor = await scenario.addMember(["emitter"]);
    await expect(
      getReviewTask(emisor.context, scenario.taskId)
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

// ---------------------------------------------------------------------------
// concludeAndAccept
// ---------------------------------------------------------------------------

describe("concludeAndAccept", () => {
  it("acepta el Contrato, cierra el Intento y la tarea, y registra la decisión", async () => {
    const scenario = await prepareScenario();
    const antes = new Date();
    await concludeAndAccept(scenario.reviewer.context, scenario.taskId);

    const [contract] = await sql<
      { status: string; accepted_at: Date | null; closed_at: Date | null }[]
    >`
      SELECT status, accepted_at, closed_at FROM contracts
      WHERE id = ${scenario.contractId}
    `;
    expect(contract.status).toBe("accepted");
    expect(contract.accepted_at).not.toBeNull();
    expect(contract.closed_at).not.toBeNull();

    const [attempt] = await sql<{ status: string; closed_at: Date | null }[]>`
      SELECT status, closed_at FROM acceptance_attempts
      WHERE id = ${scenario.attemptId}
    `;
    expect(attempt.status).toBe("accepted");
    expect(attempt.closed_at).not.toBeNull();

    const [task] = await sql<{ status: string; resolved_at: Date | null }[]>`
      SELECT status, resolved_at FROM review_tasks WHERE id = ${scenario.taskId}
    `;
    expect(task.status).toBe("resolved");
    expect(task.resolved_at).not.toBeNull();

    const [decision] = await sql<
      {
        decision: string;
        reviewer_account_id: string;
        reviewer_name: string;
        reason_code: string | null;
        reason_text: string | null;
        followed_ai_recommendation: boolean | null;
        successor_attempt_id: string | null;
        created_at: Date;
      }[]
    >`
      SELECT decision, reviewer_account_id, reviewer_name, reason_code,
             reason_text, followed_ai_recommendation, successor_attempt_id,
             created_at
      FROM review_decisions WHERE task_id = ${scenario.taskId}
    `;
    expect(decision.decision).toBe("conclude");
    expect(decision.reviewer_account_id).toBe(scenario.reviewer.account.id);
    expect(decision.reviewer_name).toBe(scenario.reviewer.account.fullName);
    expect(decision.reason_code).toBeNull();
    expect(decision.reason_text).toBeNull();
    expect(decision.followed_ai_recommendation).toBeNull();
    expect(decision.successor_attempt_id).toBeNull();
    expect(decision.created_at.getTime()).toBeGreaterThanOrEqual(
      antes.getTime() - 2000
    );
  });

  it("encola exactamente un sellado del Paquete contractual frío", async () => {
    const scenario = await prepareScenario();
    await concludeAndAccept(scenario.reviewer.context, scenario.taskId);

    const jobs = await sql<{ kind: string; dedupe_key: string | null }[]>`
      SELECT kind, dedupe_key FROM background_jobs
      WHERE payload->>'contractId' = ${scenario.contractId}
    `;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].kind).toBe("seal_cold_package");
    expect(jobs[0].dedupe_key).toBe(
      `seal_cold_package:${scenario.contractId}`
    );
  });

  it("registra el evento contractual y la entrada de auditoría", async () => {
    const scenario = await prepareScenario();
    await concludeAndAccept(scenario.reviewer.context, scenario.taskId);

    const [event] = await sql<
      {
        actor_kind: string;
        actor_id: string | null;
        actor_name: string;
        payload: Record<string, unknown>;
      }[]
    >`
      SELECT actor_kind, actor_id, actor_name, payload FROM contract_events
      WHERE contract_id = ${scenario.contractId} AND type = 'revision_concluida'
    `;
    expect(event.actor_kind).toBe("member");
    expect(event.actor_id).toBe(scenario.reviewer.account.id);
    expect(event.actor_name).toBe(scenario.reviewer.account.fullName);
    expect(event.payload).toEqual({ secuencia: 1, recomendacion_ai: null });

    const [audit] = await sql<
      { action: string; capability: string | null; subject_id: string }[]
    >`
      SELECT action, capability, subject_id FROM audit_entries
      WHERE action = 'review.conclude'
    `;
    expect(audit.subject_id).toBe(scenario.contractId);
    expect(audit.capability).toBe("reviewer");
  });

  it("exige el rol Revisor", async () => {
    const scenario = await prepareScenario();
    const administrador = await scenario.addMember(["administrator"]);
    const emisor = await scenario.addMember(["emitter"]);

    await expect(
      concludeAndAccept(administrador.context, scenario.taskId)
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      concludeAndAccept(emisor.context, scenario.taskId)
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(await countDecisions(scenario.contractId)).toBe(0);
  });

  it("relaciona la decisión con la recomendación del agente AI", async () => {
    const acompaña = await prepareScenario({ reviewPolicy: "ai" });
    await saveAiReport({
      contractId: acompaña.contractId,
      attemptId: acompaña.attemptId,
      model: "m",
      configurationVersion: "1",
      status: "completed",
      recommendation: "accept",
    });
    await concludeAndAccept(acompaña.reviewer.context, acompaña.taskId);
    const [seguida] = await sql<{ followed: boolean | null }[]>`
      SELECT followed_ai_recommendation AS followed FROM review_decisions
      WHERE task_id = ${acompaña.taskId}
    `;
    expect(seguida.followed).toBe(true);

    const aparta = await prepareScenario({ reviewPolicy: "ai" });
    await saveAiReport({
      contractId: aparta.contractId,
      attemptId: aparta.attemptId,
      model: "m",
      configurationVersion: "1",
      status: "completed",
      recommendation: "repeat",
    });
    await concludeAndAccept(aparta.reviewer.context, aparta.taskId);
    const [apartada] = await sql<{ followed: boolean | null }[]>`
      SELECT followed_ai_recommendation AS followed FROM review_decisions
      WHERE task_id = ${aparta.taskId}
    `;
    expect(apartada.followed).toBe(false);
  });

  it("una segunda decisión recibe el Revisor, la fecha y el resultado ya registrados", async () => {
    const scenario = await prepareScenario();
    await concludeAndAccept(scenario.reviewer.context, scenario.taskId);

    const [registrada] = await sql<{ created_at: Date }[]>`
      SELECT created_at FROM review_decisions WHERE task_id = ${scenario.taskId}
    `;

    let capturado: unknown;
    try {
      await concludeAndAccept(scenario.reviewer.context, scenario.taskId);
    } catch (error) {
      capturado = error;
    }
    expect(capturado).toBeInstanceOf(ConflictError);
    const message = (capturado as ConflictError).message;
    expect(message).toContain(scenario.reviewer.account.fullName);
    expect(message).toContain(formatDateTime(registrada.created_at));
    expect(message).toContain("Aceptar contrato");

    expect(await countDecisions(scenario.contractId)).toBe(1);
  });

  it("falla cuando la tarea se cerró sin decisión por una cancelación", async () => {
    const scenario = await prepareScenario();
    await cancelContract(
      scenario.fixture.context,
      scenario.contractId,
      "El Titular desistió."
    );

    await expect(
      concludeAndAccept(scenario.reviewer.context, scenario.taskId)
    ).rejects.toThrow(/se cerró sin decisión/);
    expect(await countDecisions(scenario.contractId)).toBe(0);
  });

  it("falla cuando el Contrato dejó de estar a revisión", async () => {
    const scenario = await prepareScenario();
    await sql`
      UPDATE contracts
      SET status = 'cancelled', cancelled_at = NOW(), closed_at = NOW()
      WHERE id = ${scenario.contractId}
    `;

    await expect(
      concludeAndAccept(scenario.reviewer.context, scenario.taskId)
    ).rejects.toThrow(/ya no está a revisión/);
    expect(await countDecisions(scenario.contractId)).toBe(0);
  });

  it("no encuentra la tarea de otra Organización", async () => {
    const propia = await prepareScenario();
    const ajena = await prepareScenario();
    await expect(
      concludeAndAccept(propia.reviewer.context, ajena.taskId)
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// skipAndAccept
// ---------------------------------------------------------------------------

describe("skipAndAccept", () => {
  it("acepta el Contrato y conserva una decisión documentada distinta", async () => {
    const scenario = await prepareScenario();
    await skipAndAccept(
      scenario.reviewer.context,
      scenario.taskId,
      "  Urgencia operativa del Titular.  "
    );

    expect(await contractStatus(scenario.contractId)).toBe("accepted");

    const [decision] = await sql<
      {
        decision: string;
        reason_code: string | null;
        reason_text: string | null;
        reviewer_name: string;
      }[]
    >`
      SELECT decision, reason_code, reason_text, reviewer_name
      FROM review_decisions WHERE task_id = ${scenario.taskId}
    `;
    expect(decision.decision).toBe("skip");
    expect(decision.decision).not.toBe("conclude");
    expect(decision.reason_code).toBeNull();
    expect(decision.reason_text).toBe("Urgencia operativa del Titular.");
    expect(decision.reviewer_name).toBe(scenario.reviewer.account.fullName);

    const [task] = await sql<{ status: string }[]>`
      SELECT status FROM review_tasks WHERE id = ${scenario.taskId}
    `;
    expect(task.status).toBe("resolved");

    const [attempt] = await sql<{ status: string }[]>`
      SELECT status FROM acceptance_attempts WHERE id = ${scenario.attemptId}
    `;
    expect(attempt.status).toBe("accepted");
  });

  it("no exige nota, casilla ni confirmación adicional", async () => {
    const scenario = await prepareScenario();
    await skipAndAccept(scenario.reviewer.context, scenario.taskId);

    const [decision] = await sql<{ reason_text: string | null }[]>`
      SELECT reason_text FROM review_decisions WHERE task_id = ${scenario.taskId}
    `;
    expect(decision.reason_text).toBeNull();
    expect(await contractStatus(scenario.contractId)).toBe("accepted");
  });

  it("trata una nota en blanco como ausencia de nota", async () => {
    const scenario = await prepareScenario();
    await skipAndAccept(scenario.reviewer.context, scenario.taskId, "    ");
    const [decision] = await sql<{ reason_text: string | null }[]>`
      SELECT reason_text FROM review_decisions WHERE task_id = ${scenario.taskId}
    `;
    expect(decision.reason_text).toBeNull();
  });

  it("está incluida para cualquier Revisor sin permiso adicional", async () => {
    const scenario = await prepareScenario();
    const reciente = await scenario.addMember(["reviewer"]);
    await skipAndAccept(reciente.context, scenario.taskId);

    const [decision] = await sql<{ reviewer_name: string }[]>`
      SELECT reviewer_name FROM review_decisions WHERE task_id = ${scenario.taskId}
    `;
    expect(decision.reviewer_name).toBe(reciente.account.fullName);
  });

  it("exige el rol Revisor y no basta con Administrador", async () => {
    const scenario = await prepareScenario();
    const administrador = await scenario.addMember(["administrator"]);
    await expect(
      skipAndAccept(administrador.context, scenario.taskId)
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("registra el evento y la auditoría propios de la omisión", async () => {
    const scenario = await prepareScenario();
    await skipAndAccept(scenario.reviewer.context, scenario.taskId);

    const [event] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::text AS total FROM contract_events
      WHERE contract_id = ${scenario.contractId} AND type = 'revision_omitida'
    `;
    expect(event.total).toBe("1");

    const [omitida] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::text AS total FROM audit_entries
      WHERE action = 'review.skip'
    `;
    expect(omitida.total).toBe("1");

    const [concluida] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::text AS total FROM contract_events
      WHERE contract_id = ${scenario.contractId} AND type = 'revision_concluida'
    `;
    expect(concluida.total).toBe("0");
  });

  it("el historial dice llanamente que no hubo revisión manual", async () => {
    const scenario = await prepareScenario();
    await skipAndAccept(scenario.reviewer.context, scenario.taskId);

    const detail = await getReviewTask(
      scenario.reviewer.context,
      scenario.taskId
    );
    expect(detail.decision?.decision).toBe("skip");

    await expect(
      skipAndAccept(scenario.reviewer.context, scenario.taskId)
    ).rejects.toThrow(/Omitir revisión y aceptar/);
  });

  it("encola el sellado del paquete frío igual que Aceptar contrato", async () => {
    const scenario = await prepareScenario();
    await skipAndAccept(scenario.reviewer.context, scenario.taskId);
    const jobs = await sql<{ kind: string }[]>`
      SELECT kind FROM background_jobs
      WHERE payload->>'contractId' = ${scenario.contractId}
    `;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].kind).toBe("seal_cold_package");
  });
});

// ---------------------------------------------------------------------------
// repeatProcess
// ---------------------------------------------------------------------------

describe("repeatProcess", () => {
  it("rechaza un motivo fuera de la lista cerrada", async () => {
    const scenario = await prepareScenario();
    await expect(
      repeatProcess(
        scenario.reviewer.context,
        scenario.taskId,
        "motivo_inventado" as RepeatReasonCode
      )
    ).rejects.toThrow(/Elige un motivo de la lista/);
    expect(await countDecisions(scenario.contractId)).toBe(0);
    expect(await contractStatus(scenario.contractId)).toBe("in_review");
  });

  // Defecto: `reasonCode in REPEAT_REASON_LABELS` recorre la cadena de
  // prototipos, así que `toString` supera la validación y el flujo revienta
  // con un TypeError en lugar de un ConflictError con mensaje utilizable.
  it(
    "rechaza un motivo heredado del prototipo de Object",
    async () => {
      const scenario = await prepareScenario();
      await expect(
        repeatProcess(
          scenario.reviewer.context,
          scenario.taskId,
          "toString" as RepeatReasonCode
        )
      ).rejects.toBeInstanceOf(ConflictError);
    }
  );

  it("exige texto libre únicamente cuando el motivo es Otro", async () => {
    const scenario = await prepareScenario();
    await expect(
      repeatProcess(scenario.reviewer.context, scenario.taskId, "otro")
    ).rejects.toThrow(/Describe el motivo/);
    await expect(
      repeatProcess(scenario.reviewer.context, scenario.taskId, "otro", "   ")
    ).rejects.toThrow(/Describe el motivo/);

    const resultado = await repeatProcess(
      scenario.reviewer.context,
      scenario.taskId,
      "otro",
      "  El audio se cortó a la mitad.  "
    );
    expect(resultado.token).toBeTruthy();

    const [decision] = await sql<
      { reason_code: string | null; reason_text: string | null }[]
    >`
      SELECT reason_code, reason_text FROM review_decisions
      WHERE task_id = ${scenario.taskId}
    `;
    expect(decision.reason_code).toBe("otro");
    expect(decision.reason_text).toBe("El audio se cortó a la mitad.");
  });

  it("acepta los cinco motivos tipificados sin texto libre", async () => {
    const codigos: RepeatReasonCode[] = [
      "video_incompleto",
      "declaracion_incorrecta",
      "ine_ilegible",
      "ine_incompleta",
      "evidencia_faltante",
    ];
    for (const codigo of codigos) {
      const scenario = await prepareScenario();
      await repeatProcess(scenario.reviewer.context, scenario.taskId, codigo);
      const [decision] = await sql<
        { reason_code: string | null; reason_text: string | null }[]
      >`
        SELECT reason_code, reason_text FROM review_decisions
        WHERE task_id = ${scenario.taskId}
      `;
      expect(decision.reason_code).toBe(codigo);
      expect(decision.reason_text).toBeNull();
    }
  });

  it("cierra y revoca el intento vigente y crea el sucesor con enlace nuevo", async () => {
    const scenario = await prepareScenario();
    const resultado = await repeatProcess(
      scenario.reviewer.context,
      scenario.taskId,
      "video_incompleto"
    );

    const [anterior] = await sql<{ status: string; closed_at: Date | null }[]>`
      SELECT status, closed_at FROM acceptance_attempts
      WHERE id = ${scenario.attemptId}
    `;
    expect(anterior.status).toBe("repeated");
    expect(anterior.closed_at).not.toBeNull();

    const enlaces = await sql<
      { attempt_id: string; token: string; revoked_at: Date | null }[]
    >`
      SELECT attempt_id, token, revoked_at FROM contract_links
      WHERE contract_id = ${scenario.contractId}
      ORDER BY created_at ASC
    `;
    expect(enlaces).toHaveLength(2);
    expect(enlaces[0].attempt_id).toBe(scenario.attemptId);
    expect(enlaces[0].revoked_at).not.toBeNull();
    expect(enlaces[1].revoked_at).toBeNull();
    expect(enlaces[1].token).toBe(resultado.token);
    expect(enlaces[1].token).not.toBe(enlaces[0].token);
    expect(resultado.url).toContain(resultado.token);

    const [sucesor] = await sql<
      { id: string; sequence: number; status: string; replaces: string | null }[]
    >`
      SELECT id, sequence, status, replaces_attempt_id AS replaces
      FROM acceptance_attempts
      WHERE contract_id = ${scenario.contractId} AND sequence = 2
    `;
    expect(sucesor.status).toBe("open");
    expect(sucesor.replaces).toBe(scenario.attemptId);
    expect(enlaces[1].attempt_id).toBe(sucesor.id);

    const anteriorEnlace = await loadSignerView(scenario.token);
    expect(anteriorEnlace).toEqual({ ok: false, reason: "revoked" });
  });

  it("devuelve el Contrato a Pendiente de aceptación", async () => {
    const scenario = await prepareScenario();
    await repeatProcess(
      scenario.reviewer.context,
      scenario.taskId,
      "evidencia_faltante"
    );
    expect(await contractStatus(scenario.contractId)).toBe("pending");

    const [task] = await sql<{ status: string }[]>`
      SELECT status FROM review_tasks WHERE id = ${scenario.taskId}
    `;
    expect(task.status).toBe("resolved");
  });

  it("entrega el mensaje sugerido copiable, sin enviarlo a nadie", async () => {
    const scenario = await prepareScenario();
    const resultado = await repeatProcess(
      scenario.reviewer.context,
      scenario.taskId,
      "ine_ilegible"
    );

    const [link] = await sql<{ expires_at: Date }[]>`
      SELECT expires_at FROM contract_links WHERE token = ${resultado.token}
    `;
    expect(resultado.suggestedMessage).toContain(scenario.reference);
    expect(resultado.suggestedMessage).toContain(scenario.organizationName);
    expect(resultado.suggestedMessage).toContain(
      REPEAT_REASON_LABELS.ine_ilegible.toLowerCase()
    );
    expect(resultado.suggestedMessage).toContain(resultado.url);
    expect(resultado.suggestedMessage).toContain(formatDate(link.expires_at));

    const salidas = await sql<{ total: string }[]>`
      SELECT COUNT(*)::text AS total FROM notification_outbox
    `;
    expect(salidas[0].total).toBe("0");
  });

  it("el sucesor hereda política y perfil de evidencia y ninguna evidencia previa", async () => {
    const scenario = await prepareScenario({
      requiresIne: true,
      requiresVideo: true,
    });
    const previa = await sql<{ kind: string }[]>`
      SELECT kind FROM evidence_items WHERE attempt_id = ${scenario.attemptId}
    `;
    expect(previa).toHaveLength(4);

    const resultado = await repeatProcess(
      scenario.reviewer.context,
      scenario.taskId,
      "ine_incompleta"
    );

    const vista = await loadSignerView(resultado.token);
    expect(vista.ok).toBe(true);
    if (!vista.ok) return;
    expect(vista.reviewPolicy).toBe("manual");
    expect(vista.requiresIne).toBe(true);
    expect(vista.requiresVideo).toBe(true);
    expect(vista.walked).toBe(false);
    expect(vista.stage).toBe("contract");
    expect(vista.evidence).toEqual({
      acceptance: false,
      ine_front: false,
      ine_back: false,
      video: false,
    });

    const [sucesor] = await sql<{ id: string }[]>`
      SELECT id FROM acceptance_attempts
      WHERE contract_id = ${scenario.contractId} AND sequence = 2
    `;
    const heredada = await sql<{ kind: string }[]>`
      SELECT kind FROM evidence_items WHERE attempt_id = ${sucesor.id}
    `;
    expect(heredada).toHaveLength(0);
  });

  it("registra los eventos del intento repetido y del sucesor", async () => {
    const scenario = await prepareScenario();
    await repeatProcess(
      scenario.reviewer.context,
      scenario.taskId,
      "declaracion_incorrecta"
    );

    const [sucesor] = await sql<{ id: string }[]>`
      SELECT id FROM acceptance_attempts
      WHERE contract_id = ${scenario.contractId} AND sequence = 2
    `;

    const [repetido] = await sql<
      { attempt_id: string | null; payload: Record<string, unknown> }[]
    >`
      SELECT attempt_id, payload FROM contract_events
      WHERE contract_id = ${scenario.contractId} AND type = 'proceso_repetido'
    `;
    expect(repetido.attempt_id).toBe(scenario.attemptId);
    expect(repetido.payload).toEqual({
      secuencia: 1,
      motivo: "declaracion_incorrecta",
      intento_sucesor: sucesor.id,
    });

    const [creado] = await sql<
      { attempt_id: string | null; payload: Record<string, unknown> }[]
    >`
      SELECT attempt_id, payload FROM contract_events
      WHERE contract_id = ${scenario.contractId}
        AND type = 'intento_sucesor_creado'
    `;
    expect(creado.attempt_id).toBe(sucesor.id);
    expect(creado.payload).toEqual({ reemplaza: scenario.attemptId });

    const [audit] = await sql<{ payload: Record<string, unknown> }[]>`
      SELECT payload FROM audit_entries WHERE action = 'review.repeat'
    `;
    expect(audit.payload).toEqual({
      referencia: scenario.reference,
      motivo: "declaracion_incorrecta",
    });
  });

  it("exige el rol Revisor y respeta el aislamiento por Organización", async () => {
    const propia = await prepareScenario();
    const ajena = await prepareScenario();
    const administrador = await propia.addMember(["administrator"]);

    await expect(
      repeatProcess(administrador.context, propia.taskId, "ine_ilegible")
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      repeatProcess(propia.reviewer.context, ajena.taskId, "ine_ilegible")
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("relaciona la repetición con la recomendación del agente AI", async () => {
    const scenario = await prepareScenario({ reviewPolicy: "ai" });
    await saveAiReport({
      contractId: scenario.contractId,
      attemptId: scenario.attemptId,
      model: "m",
      configurationVersion: "1",
      status: "completed",
      recommendation: "repeat",
    });
    await repeatProcess(
      scenario.reviewer.context,
      scenario.taskId,
      "video_incompleto"
    );

    const [decision] = await sql<{ followed: boolean | null }[]>`
      SELECT followed_ai_recommendation AS followed FROM review_decisions
      WHERE task_id = ${scenario.taskId}
    `;
    expect(decision.followed).toBe(true);
  });

  it("no repite una tarea ya resuelta", async () => {
    const scenario = await prepareScenario();
    await concludeAndAccept(scenario.reviewer.context, scenario.taskId);
    await expect(
      repeatProcess(scenario.reviewer.context, scenario.taskId, "ine_ilegible")
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await contractStatus(scenario.contractId)).toBe("accepted");
  });

  it("permite repetir varias veces sobre el mismo Contrato inmutable", async () => {
    const scenario = await prepareScenario();
    const primera = await repeatProcess(
      scenario.reviewer.context,
      scenario.taskId,
      "video_incompleto"
    );
    const segundo = await scenario.submit(primera.token);
    const segunda = await repeatProcess(
      scenario.reviewer.context,
      segundo.taskId,
      "ine_ilegible"
    );
    const tercero = await scenario.submit(segunda.token);

    const detail = await getReviewTask(
      scenario.reviewer.context,
      tercero.taskId
    );
    expect(detail.sequence).toBe(3);
    expect(detail.history.map((item) => item.reasonCode)).toEqual([
      "video_incompleto",
      "ine_ilegible",
    ]);
    expect(detail.contractId).toBe(scenario.contractId);
    expect(detail.reference).toBe(scenario.reference);
  });
});

// ---------------------------------------------------------------------------
// Concurrencia
// ---------------------------------------------------------------------------

describe("resolución concurrente", () => {
  it("dos decisiones en paralelo producen exactamente una decisión", async () => {
    const scenario = await prepareScenario();
    const otro = await scenario.addMember(["reviewer"]);

    const resultados = await Promise.allSettled([
      concludeAndAccept(scenario.reviewer.context, scenario.taskId),
      skipAndAccept(otro.context, scenario.taskId),
    ]);

    const cumplidas = resultados.filter(
      (item) => item.status === "fulfilled"
    ).length;
    expect(cumplidas).toBe(1);
    const rechazada = resultados.find((item) => item.status === "rejected");
    expect(rechazada?.status).toBe("rejected");
    if (rechazada?.status === "rejected") {
      expect(rechazada.reason).toBeInstanceOf(ConflictError);
    }

    const decisiones = await sql<{ decision: string }[]>`
      SELECT decision FROM review_decisions WHERE task_id = ${scenario.taskId}
    `;
    expect(decisiones).toHaveLength(1);
    expect(await contractStatus(scenario.contractId)).toBe("accepted");

    const [task] = await sql<{ status: string }[]>`
      SELECT status FROM review_tasks WHERE id = ${scenario.taskId}
    `;
    expect(task.status).toBe("resolved");
  });

  it("una repetición y una conclusión simultáneas no coexisten", async () => {
    const scenario = await prepareScenario();
    const otro = await scenario.addMember(["reviewer"]);

    const resultados = await Promise.allSettled([
      repeatProcess(scenario.reviewer.context, scenario.taskId, "ine_ilegible"),
      concludeAndAccept(otro.context, scenario.taskId),
    ]);
    expect(
      resultados.filter((item) => item.status === "fulfilled")
    ).toHaveLength(1);

    const decisiones = await sql<{ decision: string }[]>`
      SELECT decision FROM review_decisions WHERE task_id = ${scenario.taskId}
    `;
    expect(decisiones).toHaveLength(1);

    const estado = await contractStatus(scenario.contractId);
    const intentos = await sql<{ id: string }[]>`
      SELECT id FROM acceptance_attempts WHERE contract_id = ${scenario.contractId}
    `;
    if (decisiones[0].decision === "repeat") {
      expect(estado).toBe("pending");
      expect(intentos).toHaveLength(2);
    } else {
      expect(estado).toBe("accepted");
      expect(intentos).toHaveLength(1);
    }
  });

  it("una cancelación que compite con la decisión se resuelve de forma atómica", async () => {
    const scenario = await prepareScenario();

    const [cancelacion, decision] = await Promise.allSettled([
      cancelContract(scenario.fixture.context, scenario.contractId),
      concludeAndAccept(scenario.reviewer.context, scenario.taskId),
    ]);

    const ganadoras = [cancelacion, decision].filter(
      (item) => item.status === "fulfilled"
    );
    expect(ganadoras).toHaveLength(1);

    const estado = await contractStatus(scenario.contractId);
    const decisiones = await countDecisions(scenario.contractId);
    const [task] = await sql<{ status: string }[]>`
      SELECT status FROM review_tasks WHERE id = ${scenario.taskId}
    `;
    const [attempt] = await sql<{ status: string }[]>`
      SELECT status FROM acceptance_attempts WHERE id = ${scenario.attemptId}
    `;
    const trabajos = await countSealJobs(scenario.contractId);

    if (cancelacion.status === "fulfilled") {
      expect(estado).toBe("cancelled");
      expect(decisiones).toBe(0);
      expect(task.status).toBe("closed_without_decision");
      expect(attempt.status).toBe("cancelled");
      // Cancelar también cierra el Contrato y, por tanto, produce su único
      // paquete contractual frío. El dedupe evita que la decisión perdedora
      // deje un segundo trabajo.
      expect(trabajos).toBe(1);
    } else {
      expect(estado).toBe("accepted");
      expect(decisiones).toBe(1);
      expect(task.status).toBe("resolved");
      expect(attempt.status).toBe("accepted");
      expect(trabajos).toBe(1);
      const [contract] = await sql<{ cancelled_at: Date | null }[]>`
        SELECT cancelled_at FROM contracts WHERE id = ${scenario.contractId}
      `;
      expect(contract.cancelled_at).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// recordExternalContact
// ---------------------------------------------------------------------------

describe("recordExternalContact", () => {
  it("conserva canal, fecha y nota opcional sin presentarlo como entrega verificada", async () => {
    const scenario = await prepareScenario();
    await repeatProcess(
      scenario.reviewer.context,
      scenario.taskId,
      "ine_ilegible"
    );

    await recordExternalContact(
      scenario.reviewer.context,
      scenario.contractId,
      "  WhatsApp personal  ",
      "  Se envió el enlace por el canal habitual.  "
    );

    const [record] = await sql<
      {
        channel: string;
        note: string | null;
        attempt_id: string | null;
        organization_id: string;
        recorded_by: string | null;
        recorded_by_name: string;
        created_at: Date;
      }[]
    >`
      SELECT channel, note, attempt_id, organization_id, recorded_by,
             recorded_by_name, created_at
      FROM external_contact_records WHERE contract_id = ${scenario.contractId}
    `;
    expect(record.channel).toBe("WhatsApp personal");
    expect(record.note).toBe("Se envió el enlace por el canal habitual.");
    expect(record.organization_id).toBe(scenario.organizationId);
    expect(record.recorded_by).toBe(scenario.reviewer.account.id);
    expect(record.recorded_by_name).toBe(scenario.reviewer.account.fullName);
    expect(record.created_at).toBeInstanceOf(Date);

    // Queda ligado al Intento vigente, que tras repetir es el sucesor.
    const [ultimo] = await sql<{ id: string }[]>`
      SELECT id FROM acceptance_attempts
      WHERE contract_id = ${scenario.contractId}
      ORDER BY sequence DESC LIMIT 1
    `;
    expect(record.attempt_id).toBe(ultimo.id);

    // Ninguna columna afirma entrega o verificación.
    const columnas = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'fides'
        AND table_name = 'external_contact_records'
    `;
    const nombres = columnas.map((item) => item.column_name);
    expect(
      nombres.filter((name) => /deliver|verif|entrega|confirm/.test(name))
    ).toEqual([]);

    const [event] = await sql<
      { type: string; payload: Record<string, unknown> }[]
    >`
      SELECT type, payload FROM contract_events
      WHERE contract_id = ${scenario.contractId}
        AND type = 'contacto_externo_registrado'
    `;
    expect(event.payload).toEqual({ canal: "WhatsApp personal" });
    expect(Object.keys(event.payload)).toEqual(["canal"]);
  });

  it("deja la nota en nulo cuando llega vacía", async () => {
    const scenario = await prepareScenario();
    await recordExternalContact(
      scenario.reviewer.context,
      scenario.contractId,
      "Llamada",
      "   "
    );
    const [record] = await sql<{ note: string | null }[]>`
      SELECT note FROM external_contact_records
      WHERE contract_id = ${scenario.contractId}
    `;
    expect(record.note).toBeNull();
  });

  it("exige el canal utilizado", async () => {
    const scenario = await prepareScenario();
    await expect(
      recordExternalContact(
        scenario.reviewer.context,
        scenario.contractId,
        "   "
      )
    ).rejects.toThrow(/Indica el canal utilizado/);
  });

  it("no encuentra un Contrato de otra Organización", async () => {
    const propia = await prepareScenario();
    const ajena = await prepareScenario();
    await expect(
      recordExternalContact(
        propia.reviewer.context,
        ajena.contractId,
        "Correo"
      )
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("admite al Administrador y rechaza a una cuenta sólo Emisora", async () => {
    const scenario = await prepareScenario();
    const administrador = await scenario.addMember(["administrator"]);
    const emisor = await scenario.addMember(["emitter"]);

    await recordExternalContact(
      administrador.context,
      scenario.contractId,
      "Correo"
    );
    await expect(
      recordExternalContact(emisor.context, scenario.contractId, "Correo")
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("acepta un Contrato sin Intentos vigentes", async () => {
    const scenario = await prepareScenario();
    await sql`
      DELETE FROM acceptance_attempts WHERE contract_id = ${scenario.contractId}
    `;
    await recordExternalContact(
      scenario.reviewer.context,
      scenario.contractId,
      "Llamada telefónica"
    );
    const [record] = await sql<{ attempt_id: string | null }[]>`
      SELECT attempt_id FROM external_contact_records
      WHERE contract_id = ${scenario.contractId}
    `;
    expect(record.attempt_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// saveAiReport
// ---------------------------------------------------------------------------

describe("saveAiReport", () => {
  it("conserva modelo, versión, estado, transcripción, hallazgos, confianza, limitaciones y recomendación", async () => {
    const scenario = await prepareScenario({
      reviewPolicy: "ai",
      requiresVideo: true,
    });
    await saveAiReport({
      contractId: scenario.contractId,
      attemptId: scenario.attemptId,
      model: "doble-local-2",
      configurationVersion: "cfg-9",
      status: "completed",
      transcript: "Transcripción sintética del video guiado.",
      expectedStatement: "Declaración audiovisual esperada.",
      findings: [{ codigo: "coincidencia_parcial", detalle: "faltó folio" }],
      confidence: 0.5,
      limitations: "No verifica identidad ni suficiencia jurídica.",
      recommendation: "accept",
    });

    const [report] = await sql<
      {
        model: string;
        configuration_version: string;
        status: string;
        transcript: string;
        expected_statement: string;
        findings: unknown;
        confidence: string | null;
        limitations: string;
        recommendation: string | null;
        organization_id: string;
      }[]
    >`
      SELECT model, configuration_version, status, transcript,
             expected_statement, findings, confidence, limitations,
             recommendation, organization_id
      FROM ai_review_reports WHERE attempt_id = ${scenario.attemptId}
    `;
    expect(report.model).toBe("doble-local-2");
    expect(report.configuration_version).toBe("cfg-9");
    expect(report.status).toBe("completed");
    expect(report.transcript).toBe("Transcripción sintética del video guiado.");
    expect(report.expected_statement).toBe("Declaración audiovisual esperada.");
    expect(report.findings).toEqual([
      { codigo: "coincidencia_parcial", detalle: "faltó folio" },
    ]);
    expect(Number(report.confidence)).toBeCloseTo(0.5, 3);
    expect(report.limitations).toBe(
      "No verifica identidad ni suficiencia jurídica."
    );
    expect(report.recommendation).toBe("accept");
    expect(report.organization_id).toBe(scenario.organizationId);

    const [tipo] = await sql<{ tipo: string }[]>`
      SELECT jsonb_typeof(findings) AS tipo FROM ai_review_reports
      WHERE attempt_id = ${scenario.attemptId}
    `;
    expect(tipo.tipo).toBe("array");
  });

  it("usa valores mínimos cuando el análisis no aporta detalle", async () => {
    const scenario = await prepareScenario({ reviewPolicy: "ai" });
    await saveAiReport({
      contractId: scenario.contractId,
      attemptId: scenario.attemptId,
      model: "m",
      configurationVersion: "1",
      status: "completed",
    });
    const [report] = await sql<
      {
        transcript: string;
        expected_statement: string;
        findings: unknown;
        confidence: string | null;
        limitations: string;
        recommendation: string | null;
      }[]
    >`
      SELECT transcript, expected_statement, findings, confidence, limitations,
             recommendation
      FROM ai_review_reports WHERE attempt_id = ${scenario.attemptId}
    `;
    expect(report.transcript).toBe("");
    expect(report.expected_statement).toBe("");
    expect(report.findings).toEqual([]);
    expect(report.confidence).toBeNull();
    expect(report.limitations).toBe("");
    expect(report.recommendation).toBeNull();
  });

  it("registra el evento del reporte como acción del sistema", async () => {
    const scenario = await prepareScenario({ reviewPolicy: "ai" });
    await saveAiReport({
      contractId: scenario.contractId,
      attemptId: scenario.attemptId,
      model: "m",
      configurationVersion: "1",
      status: "completed",
      recommendation: "accept",
    });

    const [report] = await sql<{ id: string }[]>`
      SELECT id FROM ai_review_reports WHERE attempt_id = ${scenario.attemptId}
    `;
    const [event] = await sql<
      {
        actor_kind: string;
        actor_name: string;
        attempt_id: string | null;
        payload: Record<string, unknown>;
      }[]
    >`
      SELECT actor_kind, actor_name, attempt_id, payload FROM contract_events
      WHERE contract_id = ${scenario.contractId}
        AND type = 'reporte_ai_registrado'
    `;
    expect(event.actor_kind).toBe("system");
    expect(event.actor_name).toBe("Agente AI");
    expect(event.attempt_id).toBe(scenario.attemptId);
    expect(event.payload).toEqual({
      reporte: report.id,
      estado: "completed",
      recomendacion: "accept",
    });
  });

  it("una falla anula la recomendación y deja el Intento A revisión", async () => {
    const scenario = await prepareScenario({ reviewPolicy: "ai" });
    await saveAiReport({
      contractId: scenario.contractId,
      attemptId: scenario.attemptId,
      model: "m",
      configurationVersion: "1",
      status: "failed",
      limitations: "Tiempo de espera agotado.",
      recommendation: "repeat",
    });

    const [report] = await sql<{ recommendation: string | null }[]>`
      SELECT recommendation FROM ai_review_reports
      WHERE attempt_id = ${scenario.attemptId}
    `;
    expect(report.recommendation).toBeNull();

    expect(await contractStatus(scenario.contractId)).toBe("in_review");
    const [attempt] = await sql<{ status: string }[]>`
      SELECT status FROM acceptance_attempts WHERE id = ${scenario.attemptId}
    `;
    expect(attempt.status).toBe("in_review");
    const [task] = await sql<{ status: string }[]>`
      SELECT status FROM review_tasks WHERE id = ${scenario.taskId}
    `;
    expect(task.status).toBe("open");
    expect(await countDecisions(scenario.contractId)).toBe(0);
    const [outbox] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::text AS total FROM notification_outbox
    `;
    expect(outbox.total).toBe("0");
  });

  it("un resultado no concluyente tampoco decide ni alerta", async () => {
    const scenario = await prepareScenario({ reviewPolicy: "ai" });
    await saveAiReport({
      contractId: scenario.contractId,
      attemptId: scenario.attemptId,
      model: "m",
      configurationVersion: "1",
      status: "completed",
      recommendation: "inconclusive",
    });

    expect(await contractStatus(scenario.contractId)).toBe("in_review");
    const [outbox] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::text AS total FROM notification_outbox
    `;
    expect(outbox.total).toBe("0");
    expect(await countDecisions(scenario.contractId)).toBe(0);
  });

  it("nunca acepta, cancela ni crea un Intento por sí solo", async () => {
    const scenario = await prepareScenario({ reviewPolicy: "ai" });
    await saveAiReport({
      contractId: scenario.contractId,
      attemptId: scenario.attemptId,
      model: "m",
      configurationVersion: "1",
      status: "completed",
      recommendation: "repeat",
    });

    expect(await contractStatus(scenario.contractId)).toBe("in_review");
    expect(await countAttempts(scenario.contractId)).toBe(1);
    expect(await countDecisions(scenario.contractId)).toBe(0);
    expect(await countSealJobs(scenario.contractId)).toBe(0);

    const [task] = await sql<{ status: string }[]>`
      SELECT status FROM review_tasks WHERE id = ${scenario.taskId}
    `;
    expect(task.status).toBe("open");
    const [link] = await sql<{ revoked_at: Date | null }[]>`
      SELECT revoked_at FROM contract_links
      WHERE attempt_id = ${scenario.attemptId}
    `;
    expect(link.revoked_at).toBeNull();
  });

  it("una recomendación de repetición alerta por WhatsApp a cada Revisor activo, sin duplicar", async () => {
    const scenario = await prepareScenario({ reviewPolicy: "ai" });
    const segundo = await scenario.addMember(["reviewer"]);
    const acumulado = await scenario.addMember(["emitter", "reviewer"]);
    const emisor = await scenario.addMember(["emitter"]);

    const entrada = {
      contractId: scenario.contractId,
      attemptId: scenario.attemptId,
      model: "m",
      configurationVersion: "1",
      status: "completed" as const,
      transcript: "Transcripción con datos personales del video.",
      recommendation: "repeat" as const,
    };
    await saveAiReport(entrada);

    const salidas = await sql<
      {
        organization_id: string | null;
        channel: string;
        recipient: string;
        template: string;
        payload: Record<string, unknown>;
        dedupe_key: string | null;
        status: string;
      }[]
    >`
      SELECT organization_id, channel, recipient, template, payload,
             dedupe_key, status
      FROM notification_outbox ORDER BY recipient ASC
    `;
    expect(salidas).toHaveLength(3);
    const destinatarios = salidas.map((row) => row.recipient).sort();
    expect(destinatarios).toEqual(
      [
        scenario.reviewer.account.email,
        segundo.account.email,
        acumulado.account.email,
      ].sort()
    );
    expect(destinatarios).not.toContain(emisor.account.email);

    for (const salida of salidas) {
      expect(salida.channel).toBe("whatsapp");
      expect(salida.template).toBe("alerta_revision_ai");
      expect(salida.organization_id).toBe(scenario.organizationId);
      expect(salida.status).toBe("pending");
      expect(salida.dedupe_key).toMatch(
        new RegExp(`^ai_repeat:${scenario.attemptId}:[0-9a-f-]{36}$`)
      );
      expect(Object.keys(salida.payload).sort()).toEqual([
        "portal",
        "referencia",
        "revisor",
      ]);
      expect(salida.payload.referencia).toBe(scenario.reference);
      expect(salida.payload.portal).toBe(
        `http://localhost:3002/app/revision/${scenario.taskId}`
      );

      // Información mínima: nada del Contrato, evidencia o Firmante.
      const serializado = JSON.stringify(salida.payload);
      expect(serializado).not.toContain("Servicio sintético de prueba");
      expect(serializado).not.toContain(entrada.transcript);
      expect(serializado).not.toContain(scenario.token);
      expect(serializado).not.toContain("/c/");
      expect(serializado).not.toContain(scenario.fixture.signer.name);
    }

    // El reintento del worker no duplica la alerta: la llave de deduplicación
    // conserva exactamente una fila por Revisor.
    await saveAiReport(entrada);
    const [conteo] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::text AS total FROM notification_outbox
    `;
    expect(conteo.total).toBe("3");
    const [reportes] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::text AS total FROM ai_review_reports
      WHERE attempt_id = ${scenario.attemptId}
    `;
    expect(reportes.total).toBe("2");
  });

  it("no alerta cuando la Organización no tiene ningún Revisor", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { ai_review: true },
      defaults: { reviewPolicy: "ai" },
    });
    const draftId = await createDraft(fixture.context, {
      templateId: fixture.template.id,
    });
    await saveDraft(fixture.context, draftId, {
      holderId: fixture.holder.id,
      signerId: fixture.signer.id,
      fieldValues: { objeto: "Sin revisores", monto: "10" },
    });
    const issued = await issueContract(fixture.context, draftId);
    await loadSignerView(issued.token);
    await markContractWalked(issued.token);
    await acceptContract(issued.token, { legendAccepted: true });

    const [attempt] = await sql<{ id: string }[]>`
      SELECT id FROM acceptance_attempts WHERE contract_id = ${issued.contractId}
    `;
    await saveAiReport({
      contractId: issued.contractId,
      attemptId: attempt.id,
      model: "m",
      configurationVersion: "1",
      status: "completed",
      recommendation: "repeat",
    });

    const [conteo] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::text AS total FROM notification_outbox
    `;
    expect(conteo.total).toBe("0");
  });

  it("apunta al índice de la Bandeja cuando el Intento no tiene tarea abierta", async () => {
    const fixture = await createIssuableOrganization({
      capabilities: { ai_review: true },
    });
    const revisor = await memberOf(fixture.organization.id, ["reviewer"]);
    const draftId = await createDraft(fixture.context, {
      templateId: fixture.template.id,
    });
    await saveDraft(fixture.context, draftId, {
      holderId: fixture.holder.id,
      signerId: fixture.signer.id,
      fieldValues: { objeto: "Sin revisión", monto: "10" },
    });
    const issued = await issueContract(fixture.context, draftId);
    await loadSignerView(issued.token);
    await markContractWalked(issued.token);
    const resultado = await acceptContract(issued.token, {
      legendAccepted: true,
    });
    expect(resultado.result).toBe("accepted");

    const [attempt] = await sql<{ id: string }[]>`
      SELECT id FROM acceptance_attempts WHERE contract_id = ${issued.contractId}
    `;
    await saveAiReport({
      contractId: issued.contractId,
      attemptId: attempt.id,
      model: "m",
      configurationVersion: "1",
      status: "completed",
      recommendation: "repeat",
    });

    const [salida] = await sql<
      { recipient: string; payload: Record<string, unknown> }[]
    >`
      SELECT recipient, payload FROM notification_outbox
    `;
    expect(salida.recipient).toBe(revisor.account.email);
    expect(salida.payload.portal).toBe("http://localhost:3002/app/revision");
  });

  it("no encuentra un Contrato inexistente", async () => {
    await expect(
      saveAiReport({
        contractId: "00000000-0000-4000-8000-000000000000",
        attemptId: "00000000-0000-4000-8000-000000000001",
        model: "m",
        configurationVersion: "1",
        status: "completed",
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
