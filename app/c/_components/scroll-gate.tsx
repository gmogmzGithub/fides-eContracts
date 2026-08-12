"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SignerActionResult } from "@/app/c/_lib/result";
import { DISABLED_ACTION, PRIMARY_ACTION, TINY } from "./styles";

/**
 * Centinela al final del texto contractual. Cuando la interfaz lo alcanza se
 * habilita `Continuar` y se registra el evento técnico `Contrato recorrido`.
 * Si el texto cabe completo en la pantalla el centinela es visible de
 * inmediato y `Continuar` se habilita sin desplazamiento: es correcto.
 */
export function ScrollGate({
  walked,
  nextHref,
  onReachedEnd,
}: {
  walked: boolean;
  nextHref: string;
  onReachedEnd: () => Promise<SignerActionResult>;
}) {
  const sentinel = useRef<HTMLDivElement | null>(null);
  const sent = useRef(false);
  const [reached, setReached] = useState(walked);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (walked) {
      sent.current = true;
      return;
    }
    const node = sentinel.current;
    if (!node) return;

    let cancelled = false;

    const reachEnd = () => {
      if (cancelled || sent.current) return;
      sent.current = true;
      setReached(true);
      void onReachedEnd().then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          sent.current = false;
          setReached(false);
          setError(result.error);
        }
      });
    };

    if (typeof IntersectionObserver === "function") {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) reachEnd();
        },
        { rootMargin: "0px 0px -8px 0px", threshold: 0 }
      );
      observer.observe(node);
      return () => {
        cancelled = true;
        observer.disconnect();
      };
    }

    // Respaldo para navegadores sin IntersectionObserver.
    const check = () => {
      const rect = node.getBoundingClientRect();
      if (rect.top <= window.innerHeight) reachEnd();
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      cancelled = true;
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [walked, onReachedEnd]);

  return (
    <div className="mt-8">
      <div ref={sentinel} aria-hidden="true" className="h-px w-full" />
      <p className={`${TINY} mb-3`}>
        Fin del texto contractual. Llegar hasta aquí habilita el paso siguiente;
        es una interacción técnica de la interfaz y no un registro de lectura,
        comprensión, identidad o conformidad.
      </p>

      {reached ? (
        <Link className={PRIMARY_ACTION} href={nextHref} prefetch={false}>
          Continuar
        </Link>
      ) : (
        <button type="button" className={DISABLED_ACTION} disabled>
          Continuar
        </button>
      )}

      {!reached ? (
        <p className={`${TINY} mt-3`} role="status">
          Desplázate hasta el final del contrato para habilitar
          <span> </span>
          <strong>Continuar</strong>.
        </p>
      ) : null}

      {error ? (
        <p
          className="mt-3 rounded-lg border border-[#B45309] bg-[#FEF3C7] px-3 py-2 text-sm text-[#78350F]"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <noscript>
        <p className="mt-3 rounded-lg border border-[#B45309] bg-[#FEF3C7] px-3 py-2 text-sm text-[#78350F]">
          Puedes leer el contrato completo sin JavaScript, pero para habilitar
          <span> </span>
          <strong>Continuar</strong> y enviar evidencia necesitas activarlo en
          tu navegador y volver a abrir el enlace.
        </p>
      </noscript>
    </div>
  );
}
