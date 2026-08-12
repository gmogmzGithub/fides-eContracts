import { cookies } from "next/headers";
import QRCode from "qrcode";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { totpUri } from "@/lib/crypto/totp";
import { formatDateTime } from "@/lib/format";
import { getAccountTotpState } from "@/app/plataforma/queries";
import { cancelarAltaTotp } from "./actions";
import { ConfirmEnrollmentForm, StartEnrollmentForm } from "./enrollment-forms";

const PENDING_COOKIE = "fides_totp_pending";

export default async function CuentaPage() {
  const account = await requirePlatformAdmin();
  const state = await getAccountTotpState(account.accountId);
  const pendingSecret = (await cookies()).get(PENDING_COOKIE)?.value ?? null;

  const uri = pendingSecret ? totpUri(pendingSecret, account.email) : null;
  const qrSvg = uri ? await QRCode.toString(uri, { type: "svg", margin: 1 }) : null;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Mi cuenta"
        description="Segundo factor de las cuentas globales. Después del correo y la contraseña, la plataforma pide un código de seis dígitos generado por tu aplicación autenticadora."
      />

      <Card>
        <CardHeader
          title="Identidad"
          description="El acceso global no te convierte en Miembro, Administrador o Emisor de ninguna Organización."
          action={
            <Badge tone={account.isLegalPublisher ? "success" : "neutral"}>
              {account.isLegalPublisher
                ? "Publicador de contenido jurídico"
                : "Sólo consulta y soporte"}
            </Badge>
          }
        />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                Nombre
              </dt>
              <dd className="mt-1 text-sm text-carbon">{account.fullName}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                Correo
              </dt>
              <dd className="mt-1 text-sm text-carbon">{account.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                Segundo factor
              </dt>
              <dd className="mt-1 text-sm text-carbon">
                {state.enrolled ? (
                  <>
                    Confirmado {formatDateTime(state.confirmedAt)}
                  </>
                ) : (
                  "Sin dar de alta"
                )}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-muted">
            La contraseña no se muestra ni se administra desde aquí; se
            restablece con un enlace temporal de un solo uso.
          </p>
        </CardBody>
      </Card>

      {pendingSecret && uri ? (
        <Card>
          <CardHeader
            title="Alta en curso"
            description="Escanea el código con tu aplicación autenticadora y confirma con un código de seis dígitos. El alta termina hasta que el código coincide."
          />
          <CardBody>
            <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
              <div
                className="w-48 shrink-0 rounded-xl border border-line bg-white p-3 [&>svg]:h-auto [&>svg]:w-full"
                aria-label="Código QR para la aplicación autenticadora"
                // `qrcode` genera el SVG en servidor a partir del URI otpauth.
                dangerouslySetInnerHTML={{ __html: qrSvg ?? "" }}
              />

              <div className="grid gap-4">
                <div>
                  <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                    Clave en base32
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <code className="rounded bg-[#f5f5f4] px-2 py-1 font-mono text-sm break-all text-carbon">
                      {pendingSecret}
                    </code>
                    <CopyButton value={pendingSecret} label="Copiar clave" />
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                    URI otpauth
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <code className="rounded bg-[#f5f5f4] px-2 py-1 font-mono text-xs break-all text-carbon-soft">
                      {uri}
                    </code>
                    <CopyButton value={uri} label="Copiar URI" />
                  </div>
                </div>

                <ConfirmEnrollmentForm />

                <form action={cancelarAltaTotp}>
                  <Button type="submit" variant="ghost" size="sm">
                    Cancelar el alta
                  </Button>
                </form>
              </div>
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={
              state.enrolled
                ? "Volver a dar de alta el segundo factor"
                : "Dar de alta el segundo factor"
            }
            description={
              state.enrolled
                ? "Sustituir la clave invalida la anterior en cuanto confirmes la nueva."
                : "Generamos una clave nueva y te mostramos su código QR."
            }
          />
          <CardBody>
            {state.enrolled ? null : (
              <Alert tone="warn" title="Tu cuenta global todavía no tiene segundo factor">
                Da de alta tu aplicación autenticadora para que el acceso global
                exija correo, contraseña y código.
              </Alert>
            )}
            <div className="mt-4">
              <StartEnrollmentForm enrolled={state.enrolled} />
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
