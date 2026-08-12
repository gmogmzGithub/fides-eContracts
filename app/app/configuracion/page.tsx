import { requireOrganizationContext, requireRole } from "@/lib/auth/guards";
import { getContractAlertPreferences } from "@/lib/domain/settings";
import { REVIEW_POLICY_LABELS } from "@/lib/domain/types";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, RadioGroup, TextInput } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { ActionForm } from "@/app/app/_components/action-form";
import {
  guardarAlertas,
  guardarConfiguracion,
} from "@/app/app/configuracion/actions";

export default async function SettingsPage() {
  const context = await requireOrganizationContext();
  requireRole(context, "administrator");

  const { capabilities, defaults } = context.organization;
  const alertPreferences = await getContractAlertPreferences(context.organization.id);

  const policyOptions = [
    {
      value: "none",
      label: REVIEW_POLICY_LABELS.none,
      description:
        "Al completar la evidencia exigida, el Contrato queda aceptado de inmediato.",
    },
    {
      value: "manual",
      label: REVIEW_POLICY_LABELS.manual,
      description:
        "El intento queda `A revisión` y una persona con rol Revisor decide.",
    },
    ...(capabilities.ai_review
      ? [
          {
            value: "ai",
            label: REVIEW_POLICY_LABELS.ai,
            description:
              "El agente analiza la evidencia y recomienda un resultado; la decisión final siempre es de una persona con rol Revisor.",
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configuración"
        description="Valores predeterminados de emisión de la Organización activa y estado de su custodia."
      />

      <Card>
        <CardHeader
          title="Configuración predeterminada de emisión"
          description="El Emisor verá estos valores en la tarjeta compacta al crear un Contrato y podrá personalizarlos operación por operación."
        />
        <CardBody>
          <ActionForm action={guardarConfiguracion} submitLabel="Guardar configuración">
            <Field
              label="Vigencia del enlace"
              required
              hint="Días completos, de 1 a 30. No existe un enlace sin vencimiento."
            >
              <TextInput
                name="linkDays"
                type="number"
                min={1}
                max={30}
                step={1}
                required
                defaultValue={defaults.linkDays}
                className="max-w-40"
              />
            </Field>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium text-carbon">
                Evidencia predeterminada
              </legend>
              <p className="mb-1 text-xs text-muted">
                INE y video están disponibles para todas las Organizaciones. La
                aceptación electrónica siempre permanece activa.
              </p>
              <Checkbox
                name="requiresVideo"
                defaultChecked={defaults.requiresVideo}
                label="Requerir video"
                hint="La persona graba la declaración aprobada para ese Contrato."
              />
              <Checkbox
                name="requiresIne"
                defaultChecked={defaults.requiresIne}
                label="Requerir INE"
                hint="Captura del frente y el reverso, sin comprobación oficial del documento."
              />
            </fieldset>

            <RadioGroup
              name="reviewPolicy"
              legend="Política de revisión predeterminada"
              options={policyOptions}
              defaultValue={defaults.reviewPolicy}
            />

            <p className="text-xs text-muted">
              El cambio crea una versión operativa nueva aplicable sólo a
              emisiones futuras. Los Contratos ya emitidos conservan la
              configuración con la que se generaron.
            </p>
          </ActionForm>
        </CardBody>
      </Card>

      <Card>
        <div id="alertas" className="scroll-mt-24">
          <CardHeader
            title="Alertas de contratos"
            description="Elige cómo quieres enterarte cuando un contrato se abre, se recorre, cambia de estatus o concluye."
          />
          <CardBody>
            <ActionForm action={guardarAlertas} submitLabel="Guardar alertas">
              <div className="grid gap-5 md:grid-cols-2">
                <div className="grid gap-3 rounded-lg border border-line p-4">
                  <Checkbox
                    name="whatsappEnabled"
                    defaultChecked={alertPreferences.whatsappEnabled}
                    label="Recibir por WhatsApp"
                  />
                  <Field
                    label="Número de WhatsApp"
                    hint="Incluye código de país, por ejemplo +523312345678."
                  >
                    <TextInput
                      name="whatsappRecipient"
                      type="tel"
                      inputMode="tel"
                      defaultValue={alertPreferences.whatsappRecipient}
                      placeholder="+523312345678"
                    />
                  </Field>
                </div>

                <div className="grid gap-3 rounded-lg border border-line p-4">
                  <Checkbox
                    name="emailEnabled"
                    defaultChecked={alertPreferences.emailEnabled}
                    label="Recibir por correo"
                  />
                  <Field label="Correo para alertas">
                    <TextInput
                      name="emailRecipient"
                      type="email"
                      defaultValue={alertPreferences.emailRecipient}
                      placeholder="alertas@organizacion.com"
                    />
                  </Field>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-muted">
                Fides envía sólo la referencia y la actividad. El mensaje no incluye
                el contrato, evidencia personal ni el enlace de la persona que acepta.
              </p>
            </ActionForm>
          </CardBody>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Custodia"
          description="Información de sólo lectura sobre el resguardo de los expedientes de esta Organización."
        />
        <CardBody className="grid gap-3">
          {capabilities.active_custody ? (
            <>
              <Alert tone="info" title="Custodia activa">
                Los expedientes cerrados permanecen en acceso inmediato durante
                el primer año desde su cierre. Al cumplir ese año pasan a
                `Archivo Muerto`.
              </Alert>
              <p className="text-sm leading-relaxed text-carbon-soft">
                Sólo un Miembro activo con rol Administrador puede ejecutar
                `Descargar ZIP` o `Exportar`. Para el historial ya frío, la
                preparación se inicia automáticamente y el archivo queda
                disponible en un máximo de 48 horas; cada copia temporal dura
                tres días completos y después vuelve a resguardarse.
              </p>
            </>
          ) : (
            <>
              <Alert tone="info" title="Custodia fría base">
                Los contratos de esta Organización están resguardados. El portal
                no ofrece exportación masiva, formulario, ticket ni recuperación
                autoservicio.
              </Alert>
              <p className="text-sm leading-relaxed text-carbon-soft">
                Cualquier solicitud se pide y se valida fuera de la plataforma
                mediante el canal externo de custodia acordado. Cuando una
                solicitud aprobada termina, el archivo aparece dentro del
                apartado ordinario del propio expediente durante tres días
                completos y sólo un Miembro activo con rol Administrador puede
                descargarlo.
              </p>
            </>
          )}
          <p className="text-xs text-muted">
            La modalidad de custodia cambia la forma y el tiempo de acceso, no
            si el expediente se conserva.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
