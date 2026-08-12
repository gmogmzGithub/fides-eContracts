"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Props {
  href: string;
  label: string;
  /** `/plataforma` sólo se marca activo en la raíz de la superficie. */
  exact?: boolean;
}

export function PlatformNavLink({ href, label, exact = false }: Props) {
  const pathname = usePathname() ?? "";
  const active = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={[
        "cursor-pointer rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-200",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        active
          ? "bg-white/10 text-accent"
          : "text-white/70 hover:bg-white/5 hover:text-ivory",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}
