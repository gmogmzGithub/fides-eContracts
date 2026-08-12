import Link from "next/link";
import { requireOrganizationContext, requireRole } from "@/lib/auth/guards";
import { getDraft } from "@/lib/domain/drafts";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Select, TextInput } from "@/components/ui/field";
import { ActionForm } from "@/app/app/_components/action-form";
import type { RawSearchParams } from "@/app/app/_lib/search-params";
import { single } from "@/app/app/_lib/search-params";
import { agregarParte } from "./actions";

export default async function AddPartyPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const context = await requireOrganizationContext();
  requireRole(context, "emitter");
  const query = await searchParams;
  const draftId = single(query, "borrador");
  const party = single(query, "parte") === "signer" ? "signer" : "holder";
  const draft = await getDraft(context, draftId);
  const backHref = `/app/contratos/nuevo/${draft.id}`;
  const signer = party === "signer";

  return (
    <div className="space-y-6">
      <PageHeader
        title={signer ? "Agregar a la persona que aceptará" : "Agregar empresa o persona"}
        description={`${draft.template.name} · completa sólo los datos que correspondan.`}
        actions={
          <Link
            href={backHref}
            className="cursor-pointer text-sm text-carbon-soft underline-offset-4 transition-colors duration-200 hover:text-carbon hover:underline"
          >
            Volver al contrato
          </Link>
        }
      />

      <Card>
        <CardHeader
          title={signer ? "Persona que aceptará" : "Titular del contrato"}
          description="Al guardar, este dato quedará seleccionado en el contrato que estás creando."
        />
        <CardBody>
          <ActionForm
            action={agregarParte}
            submitLabel="Guardar y volver al contrato"
            hidden={{ draftId: draft.id, party }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {!signer ? (
                <Field label="Tipo" required>
                  <Select
                    name="personKind"
                    required
                    defaultValue="moral"
                    options={[
                      { value: "moral", label: "Empresa" },
                      { value: "fisica", label: "Persona" },
                    ]}
                  />
                </Field>
              ) : null}
              <Field
                label={signer ? "Nombre completo" : "Nombre o razón social"}
                required
              >
                <TextInput name="name" required maxLength={200} autoFocus />
              </Field>
              <Field label="RFC" hint="Sólo si aplica a este contrato.">
                <TextInput name="rfc" maxLength={20} />
              </Field>
              <Field label="Correo">
                <TextInput name="email" type="email" maxLength={160} />
              </Field>
              <Field label="Teléfono">
                <TextInput name="phone" type="tel" maxLength={40} />
              </Field>
              <Field label="Cargo o facultades">
                <TextInput name="position" maxLength={160} />
              </Field>
              <Field label="Domicilio" className="sm:col-span-2">
                <TextInput name="address" maxLength={240} />
              </Field>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}
