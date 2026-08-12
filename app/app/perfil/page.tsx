import { requireAccount } from "@/lib/auth/guards";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, TextInput } from "@/components/ui/field";
import { ActionForm } from "@/app/app/_components/action-form";
import { guardarNombre } from "@/app/app/perfil/actions";

export default async function ProfilePage() {
  const account = await requireAccount();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mi perfil"
        description="Datos de tu Cuenta individual. Son los mismos en todas las Organizaciones a las que perteneces."
      />

      <Card>
        <CardHeader
          title="Correo"
          description="El correo de una Cuenta individual nunca se edita."
        />
        <CardBody className="grid gap-2">
          <p className="text-[0.9375rem] break-all text-carbon">{account.email}</p>
          <p className="text-xs leading-relaxed text-muted">
            Para operar con otra dirección, un Administrador debe crear y activar
            un acceso nuevo con el correo correcto y eliminar después el
            anterior.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Nombre completo"
          description="Sólo tú puedes corregir tu nombre."
        />
        <CardBody>
          <ActionForm action={guardarNombre} submitLabel="Guardar nombre">
            <Field label="Nombre completo" required>
              <TextInput
                name="fullName"
                required
                maxLength={120}
                autoComplete="name"
                defaultValue={account.fullName}
              />
            </Field>
            <p className="text-xs leading-relaxed text-muted">
              El nombre nuevo se usará en tus acciones futuras. Cada Contrato y
              cada evento anterior conserva la copia del nombre vigente cuando
              ocurrió la acción.
            </p>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}

