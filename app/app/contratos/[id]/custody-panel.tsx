import type { CustodyState } from "@/lib/domain/custody";
import { formatBytes, formatDate, formatDateTime } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { ActionForm } from "@/app/app/_components/action-form";
import { buttonClass } from "@/components/ui/button";
import {
  exportarExpediente,
  prepararArchivoHistorico,
} from "@/app/app/contratos/[id]/actions";

/**
 * Custodia del expediente. Sin Custodia activa el portal sólo informa el
 * resguardo: cualquier solicitud se pide y valida por el canal externo
 * acordado, fuera de la plataforma.
 */
export function CustodyPanel({
  contractId,
  custody,
}: {
  contractId: string;
  custody: CustodyState;
}) {
  // Sin paquete sellado no hay nada que preparar ni exportar: ofrecerlo sólo
  // produciría un trabajo que falla después, fuera de la vista del portal.
  // `canRequest` ya exige Administrador, Custodia activa y paquete sellado.
  const showActions = custody.canRequest;

  return (
    <Card>
      <CardHeader title="Custodia del expediente" />
      <CardBody>
        <div className="grid gap-4">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="font-medium text-carbon">Estado:</dt>
              <dd className="text-carbon-soft">
                {custody.sealed ? "Resguardado" : "Todavía sin cerrar"}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-carbon">Ubicación:</dt>
              <dd className="text-carbon-soft">
                {custody.tier === "immediate"
                  ? "Acceso inmediato"
                  : custody.tier === "cold"
                    ? "Archivo Muerto"
                    : "—"}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-carbon">Cierre:</dt>
              <dd className="text-carbon-soft">
                {custody.closedAt ? formatDate(custody.closedAt) : "—"}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-carbon">Tamaño:</dt>
              <dd className="text-carbon-soft">
                {custody.byteSize ? formatBytes(custody.byteSize) : "—"}
              </dd>
            </div>
            {custody.packageHash ? (
              <div className="flex gap-2 sm:col-span-2">
                <dt className="font-medium text-carbon">Huella del paquete:</dt>
                <dd className="font-mono text-xs break-all text-carbon-soft">
                  {custody.packageHash}
                </dd>
              </div>
            ) : null}
          </dl>

          <Alert tone="info">{custody.message}</Alert>

          {custody.recovery ? (
            <p className="text-sm text-carbon-soft">
              Preparación registrada: {custody.recovery.status}
              {custody.recovery.availableUntil
                ? ` · Disponible hasta ${formatDateTime(custody.recovery.availableUntil)}`
                : ""}
              .
            </p>
          ) : null}

          {custody.temporaryCopy ? (
            <p className="text-sm text-carbon-soft">
              Copia temporal disponible hasta{" "}
              {formatDateTime(custody.temporaryCopy.availableUntil)}. Sólo un
              Miembro activo con rol Administrador puede descargarla.
            </p>
          ) : null}

          {custody.export ? (
            <p className="text-sm text-carbon-soft">
              Exportación registrada: {custody.export.status}
              {custody.export.availableUntil
                ? ` · Disponible hasta ${formatDateTime(custody.export.availableUntil)}`
                : ""}
              .
            </p>
          ) : null}

          {showActions ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {custody.canDownload ? (
                <a
                  href={`/app/contratos/${contractId}/archivo`}
                  className={buttonClass("secondary", "sm")}
                >
                  Descargar ZIP
                </a>
              ) : (
                <ActionForm
                  action={prepararArchivoHistorico}
                  submitLabel="Preparar ZIP"
                  variant="secondary"
                  size="sm"
                  hidden={{ contractId }}
                />
              )}
              {custody.canDownloadExport && custody.export ? (
                <a
                  href={`/app/exportaciones/${custody.export.id}`}
                  className={buttonClass("secondary", "sm")}
                >
                  Descargar exportación
                </a>
              ) : custody.export?.status === "queued" ||
                custody.export?.status === "running" ? null : (
                <ActionForm
                  action={exportarExpediente}
                  submitLabel="Exportar"
                  variant="secondary"
                  size="sm"
                  hidden={{ contractId }}
                />
              )}
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
