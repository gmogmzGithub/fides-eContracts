import { Archive, FileText, FolderOpen, History, Search } from "lucide-react";
import type { ComponentType } from "react";
import { StatusBadge } from "@/components/ui/badge";
import type { ContractStatus } from "@/lib/domain/types";

interface SampleRow {
  reference: string;
  template: string;
  holder: string;
  status: ContractStatus;
  issued: string;
}

/** Datos evidentemente sintéticos: la muestra no representa una operación real. */
const ROWS: SampleRow[] = [
  {
    reference: "AC-20260801-0012",
    template: "Prestación de servicios",
    holder: "Empresa Sintética Uno",
    status: "pending",
    issued: "01 ago 2026",
  },
  {
    reference: "AC-20260801-0011",
    template: "Arrendamiento de equipo",
    holder: "Empresa Sintética Dos",
    status: "in_review",
    issued: "01 ago 2026",
  },
  {
    reference: "AC-20260731-0009",
    template: "Prestación de servicios",
    holder: "Persona Sintética Tres",
    status: "accepted",
    issued: "31 jul 2026",
  },
  {
    reference: "AC-20260730-0004",
    template: "Servicio recurrente",
    holder: "Empresa Sintética Cuatro",
    status: "expired",
    issued: "30 jul 2026",
  },
];

const NAV: { label: string; icon: ComponentType<{ className?: string }> }[] = [
  { label: "Contratos", icon: FileText },
  { label: "A revisión", icon: Search },
  { label: "Recientes", icon: History },
  { label: "Carpetas", icon: FolderOpen },
  { label: "Archivados", icon: Archive },
];

export function ProductSample() {
  return (
    <section
      id="muestra"
      className="mx-auto max-w-editorial px-5 py-20 sm:px-8 sm:py-28"
    >
      <div className="max-w-2xl">
        <p className="text-xs font-medium tracking-[0.22em] text-accent-strong uppercase">
          Muestra del producto
        </p>
        <h2 className="mt-5 font-display text-3xl leading-tight font-semibold tracking-tight text-carbon text-balance sm:text-4xl">
          El portal abre directamente en la lista de Contratos.
        </h2>
        <p className="mt-5 text-base leading-relaxed text-carbon-soft">
          Sin tableros intermedios: buscador, estado visible y expediente a un
          clic. En móvil la misma lista se presenta como tarjetas legibles.
        </p>
      </div>

      <div className="mt-14 grid gap-8 lg:grid-cols-[1.55fr_0.45fr] lg:items-start">
        {/* Portal de la Organización */}
        <figure className="overflow-hidden rounded-xl border border-line bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-line bg-[#f5f5f4] px-4 py-2.5">
            <span className="size-2.5 rounded-full bg-[#d6d3d1]" aria-hidden="true" />
            <span className="size-2.5 rounded-full bg-[#d6d3d1]" aria-hidden="true" />
            <span className="size-2.5 rounded-full bg-[#d6d3d1]" aria-hidden="true" />
            <span className="ml-3 text-xs text-muted">Organización Demostrativa</span>
          </div>

          <div className="grid sm:grid-cols-[13rem_1fr]">
            <div className="hidden bg-carbon px-4 py-6 sm:block">
              <p className="px-3 text-[0.6875rem] tracking-[0.18em] text-ivory/40 uppercase">
                Portal
              </p>
              <ul className="mt-4 grid gap-1">
                {NAV.map(({ label, icon: Icon }, index) => (
                  <li key={label}>
                    <span
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${
                        index === 0
                          ? "bg-white/10 font-medium text-ivory"
                          : "text-ivory/55"
                      }`}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                      {label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="px-5 py-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-display text-xl font-semibold text-carbon">
                  Contratos
                </h3>
                <span className="rounded-lg bg-carbon px-3.5 py-1.5 text-xs font-semibold text-ivory">
                  Crear contrato
                </span>
              </div>

              <div className="mt-4 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-muted">
                <Search className="size-4" aria-hidden="true" />
                Buscar por referencia, empresa, persona o dato destacado
              </div>

              <div className="mt-5 overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-[0.6875rem] tracking-wide text-muted uppercase">
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        Referencia
                      </th>
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        Titular contractual
                      </th>
                      <th
                        scope="col"
                        className="hidden py-2 pr-4 font-semibold md:table-cell"
                      >
                        Contrato-plantilla
                      </th>
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        Estado
                      </th>
                      <th
                        scope="col"
                        className="hidden py-2 font-semibold lg:table-cell"
                      >
                        Emitido
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {ROWS.map((row) => (
                      <tr key={row.reference}>
                        <td className="py-3 pr-4 font-medium whitespace-nowrap text-carbon">
                          {row.reference}
                        </td>
                        <td className="py-3 pr-4 text-carbon-soft">
                          {row.holder}
                        </td>
                        <td className="hidden py-3 pr-4 text-carbon-soft md:table-cell">
                          {row.template}
                        </td>
                        <td className="py-3 pr-4">
                          <StatusBadge status={row.status} />
                        </td>
                        <td className="hidden py-3 whitespace-nowrap text-carbon-soft lg:table-cell">
                          {row.issued}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="mt-4 text-xs text-muted">
                Página 1 de 1 (4 resultados)
              </p>
            </div>
          </div>
        </figure>

        {/* Recorrido del Firmante */}
        <figure className="mx-auto w-full max-w-[19rem] overflow-hidden rounded-[1.75rem] border-8 border-carbon bg-white shadow-xl">
          <div className="bg-carbon px-4 pb-3 text-ivory">
            <p className="text-[0.6875rem] tracking-wide text-ivory/60">
              Organización Demostrativa · AC-20260801-0012
            </p>
            <div className="mt-3 flex items-center gap-1.5 text-[0.625rem] tracking-wide uppercase">
              <span className="rounded-full bg-accent px-2 py-0.5 font-semibold text-carbon-deep">
                Contrato
              </span>
              <span className="text-ivory/35">─</span>
              <span className="text-ivory/50">Evidencia</span>
              <span className="text-ivory/35">─</span>
              <span className="text-ivory/50">Aceptar</span>
            </div>
          </div>

          <div className="px-4 py-5">
            <h3 className="font-display text-lg font-semibold text-carbon">
              Prestación de servicios
            </h3>
            <div className="mt-3 space-y-2" aria-hidden="true">
              {[
                "w-full",
                "w-[92%]",
                "w-[97%]",
                "w-[88%]",
                "w-full",
                "w-[74%]",
                "w-[94%]",
                "w-[60%]",
              ].map((width, index) => (
                <span
                  key={index}
                  className={`block h-2 rounded-full bg-[#eceae7] ${width}`}
                />
              ))}
            </div>
            <p className="mt-5 text-xs leading-relaxed text-muted">
              Recorre el documento completo para habilitar `Continuar`.
            </p>
            <span className="mt-4 block rounded-lg bg-[#e7e5e4] px-4 py-2.5 text-center text-sm font-semibold text-muted">
              Continuar
            </span>
          </div>
        </figure>
      </div>

      <p className="mt-8 text-xs text-muted">
        Muestra sintética de la interfaz. Las Organizaciones, personas, empresas
        y referencias son ficticias.
      </p>
    </section>
  );
}
