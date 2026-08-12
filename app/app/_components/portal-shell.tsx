"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Archive,
  FileText,
  FolderClosed,
  Menu,
  PenLine,
  Settings,
  ShieldCheck,
  History,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { cambiarOrganizacion } from "@/app/app/actions";
import { cerrarSesion } from "@/app/acceso/actions";
import { Wordmark } from "@/components/landing/wordmark";

export type NavIcon =
  | "contracts"
  | "create"
  | "review"
  | "directory"
  | "folders"
  | "archived"
  | "deleted"
  | "access"
  | "settings";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
}

export interface ShellOrganization {
  id: string;
  name: string;
}

const ICONS: Record<NavIcon, typeof FileText> = {
  contracts: FileText,
  create: PenLine,
  review: ShieldCheck,
  directory: History,
  folders: FolderClosed,
  archived: Archive,
  deleted: Trash2,
  access: UsersRound,
  settings: Settings,
};

function isActive(pathname: string, href: string): boolean {
  if (href === "/app/contratos") {
    return pathname === href || /^\/app\/contratos\/(?!nuevo)/.test(pathname);
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1" aria-label="Secciones del portal">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              active
                ? "bg-accent text-carbon font-semibold"
                : "text-ivory/85 hover:bg-carbon-soft"
            }`}
          >
            <Icon aria-hidden className="h-4 w-4 shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function OrganizationSwitcher({
  organizations,
  activeId,
}: {
  organizations: ShellOrganization[];
  activeId: string;
}) {
  if (organizations.length < 2) return null;
  return (
    <form
      action={async (data: FormData) => {
        await cambiarOrganizacion({ ok: true }, data);
      }}
      className="flex items-center gap-2"
    >
      <label htmlFor="organizationId" className="sr-only">
        Organización activa
      </label>
      <select
        id="organizationId"
        name="organizationId"
        defaultValue={activeId}
        className="cursor-pointer rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink transition-colors duration-200 focus:border-carbon focus:outline-none"
      >
        {organizations.map((organization) => (
          <option key={organization.id} value={organization.id}>
            {organization.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="cursor-pointer rounded-lg border-2 border-carbon px-3 py-1.5 text-sm font-semibold text-carbon transition-colors duration-200 hover:bg-carbon hover:text-ivory"
      >
        Cambiar
      </button>
    </form>
  );
}

export function PortalShell({
  items,
  organizations,
  activeOrganization,
  accountName,
  children,
}: {
  items: NavItem[];
  organizations: ShellOrganization[];
  activeOrganization: ShellOrganization | null;
  accountName: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-ivory text-ink lg:flex">
      {/* Barra lateral oscura en escritorio */}
      <aside className="hidden w-64 shrink-0 flex-col bg-carbon px-4 py-6 lg:flex">
        <Link
          href="/app/contratos"
          className="mb-8 block w-fit cursor-pointer rounded-md px-3 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          <Wordmark tone="light" />
        </Link>
        <NavList items={items} pathname={pathname} />
      </aside>

      {/* Menú deslizable en móvil */}
      {menuOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 cursor-pointer bg-black/50 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-carbon px-4 py-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between px-3">
              <Wordmark tone="light" />
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Cerrar menú"
                className="cursor-pointer rounded-lg p-1 text-ivory/85 transition-colors duration-200 hover:bg-carbon-soft"
              >
                <X aria-hidden className="h-5 w-5" />
              </button>
            </div>
            <NavList
              items={items}
              pathname={pathname}
              onNavigate={() => setMenuOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-line bg-ivory/95 px-4 py-3 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menú"
            className="cursor-pointer rounded-lg border border-line p-2 transition-colors duration-200 hover:bg-[#f5f5f4] lg:hidden"
          >
            <Menu aria-hidden className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            {activeOrganization ? (
              <p className="truncate font-display text-lg leading-tight text-carbon">
                {activeOrganization.name}
              </p>
            ) : (
              <Wordmark />
            )}
            <p className="truncate text-xs text-carbon-soft">{accountName}</p>
          </div>

          <div className="flex items-center gap-2">
            <OrganizationSwitcher
              organizations={organizations}
              activeId={activeOrganization?.id ?? ""}
            />
            <Link
              href="/app/perfil"
              className="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-carbon transition-colors duration-200 hover:bg-[#f5f5f4]"
            >
              Mi perfil
            </Link>
            <form action={cerrarSesion}>
              <button
                type="submit"
                className="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-carbon-soft transition-colors duration-200 hover:bg-[#f5f5f4] hover:text-carbon"
              >
                Cerrar sesión
              </button>
            </form>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
