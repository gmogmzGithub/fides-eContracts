import Link from "next/link";
import { Bell, Mail, MessageCircle } from "lucide-react";
import type { ContractAlertItem } from "@/lib/domain/contract-alerts";
import type { ContractAlertPreferences } from "@/lib/domain/settings";
import { formatDateTime } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

export function ContractAlerts({
  alerts,
  preferences,
  canConfigure,
}: {
  alerts: ContractAlertItem[];
  preferences: ContractAlertPreferences;
  canConfigure: boolean;
}) {
  const channels = [
    ...(preferences.whatsappEnabled
      ? [{ label: "WhatsApp", Icon: MessageCircle }]
      : []),
    ...(preferences.emailEnabled ? [{ label: "Correo", Icon: Mail }] : []),
  ];

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Bell aria-hidden className="size-4 text-accent-strong" />
            Alertas
          </span>
        }
        description="Actividad reciente de tus contratos."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {channels.map(({ label, Icon }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-strong"
              >
                <Icon aria-hidden className="size-3.5" />
                {label}
              </span>
            ))}
            {canConfigure ? (
              <Link
                href="/app/configuracion#alertas"
                className="cursor-pointer text-xs font-medium text-carbon-soft underline-offset-4 transition-colors duration-200 hover:text-carbon hover:underline"
              >
                Configurar
              </Link>
            ) : null}
          </div>
        }
      />
      <CardBody>
        {alerts.length === 0 ? (
          <p className="text-sm text-carbon-soft">
            La apertura, el recorrido, la aceptación y cada cambio de estatus
            aparecerán aquí.
          </p>
        ) : (
          <ol className="divide-y divide-line">
            {alerts.map((alert) => (
              <li
                key={alert.id}
                className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
              >
                <Link
                  href={`/app/contratos/${alert.contractId}`}
                  className="cursor-pointer text-sm text-carbon underline-offset-4 transition-colors duration-200 hover:text-accent-strong hover:underline"
                >
                  <strong>{alert.reference}</strong> {alert.message}
                </Link>
                <time className="shrink-0 text-xs text-muted">
                  {formatDateTime(alert.createdAt)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
