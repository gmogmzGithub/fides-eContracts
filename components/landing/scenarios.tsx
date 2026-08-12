import {
  Briefcase,
  GraduationCap,
  HeartPulse,
  Landmark,
  Plane,
  Truck,
} from "lucide-react";
import type { ComponentType } from "react";

interface Scenario {
  icon: ComponentType<{ className?: string }>;
  industry: string;
  copy: string;
}

const SCENARIOS: Scenario[] = [
  {
    icon: Briefcase,
    industry: "Servicios profesionales",
    copy: "Prestación de servicios con entregables, plazos y honorarios definidos.",
  },
  {
    icon: Landmark,
    industry: "Arrendamiento",
    copy: "Arrendamiento de inmuebles, equipo y espacios operativos.",
  },
  {
    icon: Truck,
    industry: "Logística y transporte",
    copy: "Traslados, cartas de instrucción y servicios recurrentes de flota.",
  },
  {
    icon: HeartPulse,
    industry: "Salud",
    copy: "Servicios clínicos y consentimientos con el aviso vigente de la Organización.",
  },
  {
    icon: GraduationCap,
    industry: "Educación",
    copy: "Inscripción, colegiaturas y programas por periodo escolar.",
  },
  {
    icon: Plane,
    industry: "Aviación privada",
    copy: "Fletamento y servicios especializados con condiciones por operación.",
  },
];

export function Scenarios() {
  return (
    <section
      id="escenarios"
      className="mx-auto max-w-editorial px-5 py-20 sm:px-8 sm:py-28"
    >
      <div className="max-w-2xl">
        <p className="text-xs font-medium tracking-[0.22em] text-accent-strong uppercase">
          Escenarios
        </p>
        <h2 className="mt-5 font-display text-3xl leading-tight font-semibold tracking-tight text-carbon text-balance sm:text-4xl">
          Una misma plataforma para operaciones contractuales distintas.
        </h2>
        <p className="mt-5 text-base leading-relaxed text-carbon-soft">
          El contenido jurídico de cada Organización se prepara, aprueba y
          publica antes de que su equipo empiece a operar. La plataforma no es un
          editor libre de documentos: presenta el texto publicado y las decisiones
          que cada Contrato admite.
        </p>
      </div>

      <ul className="mt-14 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
        {SCENARIOS.map(({ icon: Icon, industry, copy }) => (
          <li
            key={industry}
            className="group bg-white px-7 py-8 transition-colors duration-200 hover:bg-[#fcfbf9]"
          >
            <Icon
              className="size-5 text-accent-strong transition-colors duration-200"
              aria-hidden="true"
            />
            <h3 className="mt-5 font-display text-xl font-semibold text-carbon">
              {industry}
            </h3>
            <p className="mt-2.5 text-sm leading-relaxed text-carbon-soft">{copy}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
