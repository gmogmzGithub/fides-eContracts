import "server-only";
import type { Sql, Transaction } from "@/lib/db";
import { sql as rootSql } from "@/lib/db";
import { contractAlertMessage } from "@/lib/domain/alert-copy";

export type Executor = Sql | Transaction;

export interface AuditInput {
  organizationId?: string | null;
  accountId?: string | null;
  actorName?: string;
  actorKind?: "member" | "platform" | "signer" | "system";
  capability?: string | null;
  action: string;
  subjectType?: string;
  subjectId?: string | null;
  payload?: Record<string, unknown>;
}

export async function recordAudit(
  input: AuditInput,
  executor: Executor = rootSql
): Promise<void> {
  await executor`
    INSERT INTO audit_entries (
      organization_id, account_id, actor_name, actor_kind, capability,
      action, subject_type, subject_id, payload
    ) VALUES (
      ${input.organizationId ?? null}, ${input.accountId ?? null},
      ${input.actorName ?? ""}, ${input.actorKind ?? "member"},
      ${input.capability ?? null}, ${input.action},
      ${input.subjectType ?? ""}, ${input.subjectId ?? null},
      ${JSON.stringify(input.payload ?? {})}::text::jsonb
    )
  `;
}

export interface ContractEventInput {
  contractId: string;
  organizationId: string;
  attemptId?: string | null;
  type: string;
  actorKind: "member" | "signer" | "platform" | "system";
  actorId?: string | null;
  actorName?: string;
  sensitive?: boolean;
  payload?: Record<string, unknown>;
}

export async function recordContractEvent(
  input: ContractEventInput,
  executor: Executor = rootSql
): Promise<void> {
  const [event] = await executor<{ id: string }[]>`
    INSERT INTO contract_events (
      contract_id, organization_id, attempt_id, type, actor_kind,
      actor_id, actor_name, sensitive, payload
    ) VALUES (
      ${input.contractId}, ${input.organizationId}, ${input.attemptId ?? null},
      ${input.type}, ${input.actorKind}, ${input.actorId ?? null},
      ${input.actorName ?? ""}, ${input.sensitive ?? false},
      ${JSON.stringify(input.payload ?? {})}::text::jsonb
    )
    RETURNING id
  `;

  const message = contractAlertMessage(input.type);
  if (!message) return;

  const delivery = (await executor<
    {
      reference: string;
      email_enabled: boolean;
      email_recipient: string | null;
      whatsapp_enabled: boolean;
      whatsapp_recipient: string | null;
    }[]
  >`
    SELECT c.reference,
           COALESCE(settings.alert_email_enabled, FALSE) AS email_enabled,
           settings.alert_email_recipient AS email_recipient,
           COALESCE(settings.alert_whatsapp_enabled, FALSE) AS whatsapp_enabled,
           settings.alert_whatsapp_recipient AS whatsapp_recipient
    FROM contracts c
    LEFT JOIN organization_settings settings
      ON settings.organization_id = c.organization_id
    WHERE c.id = ${input.contractId}
      AND c.organization_id = ${input.organizationId}
  `)[0]!;

  const payload = {
    reference: delivery.reference,
    message,
    eventType: input.type,
    eventId: event.id,
    portalPath: `/app/contratos/${input.contractId}`,
  };
  if (delivery.email_enabled && delivery.email_recipient) {
    await enqueueNotification(
      {
        organizationId: input.organizationId,
        channel: "email",
        recipient: delivery.email_recipient,
        template: "actividad_contractual",
        payload,
        dedupeKey: `contract-alert:${event.id}:email`,
      },
      executor
    );
  }
  if (delivery.whatsapp_enabled && delivery.whatsapp_recipient) {
    await enqueueNotification(
      {
        organizationId: input.organizationId,
        channel: "whatsapp",
        recipient: delivery.whatsapp_recipient,
        template: "actividad_contractual",
        payload,
        dedupeKey: `contract-alert:${event.id}:whatsapp`,
      },
      executor
    );
  }
}

export interface NotificationInput {
  organizationId?: string | null;
  channel: "email" | "whatsapp";
  recipient: string;
  template: string;
  payload?: Record<string, unknown>;
  dedupeKey?: string | null;
}

/**
 * Outbox: la aplicación nunca llama a un proveedor externo dentro de la
 * transacción de negocio. El worker entrega de forma idempotente.
 */
export async function enqueueNotification(
  input: NotificationInput,
  executor: Executor = rootSql
): Promise<void> {
  await executor`
    INSERT INTO notification_outbox (
      organization_id, channel, recipient, template, payload, dedupe_key
    ) VALUES (
      ${input.organizationId ?? null}, ${input.channel}, ${input.recipient},
      ${input.template}, ${JSON.stringify(input.payload ?? {})}::text::jsonb,
      ${input.dedupeKey ?? null}
    )
    ON CONFLICT (dedupe_key) DO NOTHING
  `;
}

export type JobKind =
  | "ai_review"
  | "seal_cold_package"
  | "recovery"
  | "export"
  | "move_to_cold";

export async function enqueueJob(
  kind: JobKind,
  payload: Record<string, unknown>,
  options: { dedupeKey?: string; runAfter?: Date } = {},
  executor: Executor = rootSql
): Promise<void> {
  await executor`
    INSERT INTO background_jobs (kind, payload, dedupe_key, run_after)
    VALUES (
      ${kind}, ${JSON.stringify(payload)}::text::jsonb,
      ${options.dedupeKey ?? null}, ${options.runAfter ?? new Date()}
    )
    ON CONFLICT (dedupe_key) DO NOTHING
  `;
}
