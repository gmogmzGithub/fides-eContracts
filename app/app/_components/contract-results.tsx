import Link from "next/link";
import type { ReactNode } from "react";
import type { ContractRow } from "@/lib/domain/contracts";
import { formatDate } from "@/lib/format";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";

function Highlighted({ items }: { items: { label: string; value: string }[] }) {
  if (items.length === 0) return null;
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-carbon-soft">
      {items.map((item) => (
        <div key={item.label} className="flex gap-1">
          <dt className="font-medium">{item.label}:</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Resultados del buscador. En escritorio se usa tabla y en móvil tarjetas
 * legibles. `Eliminados` conserva metadatos mínimos y no abre el expediente.
 */
export function ContractResults({
  rows,
  linkToFile = true,
  emptyTitle,
  emptyDescription,
  renderAction,
}: {
  rows: ContractRow[];
  linkToFile?: boolean;
  emptyTitle: string;
  emptyDescription: string;
  renderAction?: (row: ContractRow) => ReactNode;
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <THead>
            <Tr>
              <Th>Referencia</Th>
              <Th>Titular contractual</Th>
              <Th>Firmante</Th>
              <Th>Estado</Th>
              <Th>Fecha</Th>
              <Th>Datos destacados</Th>
              {renderAction ? <Th>Acciones</Th> : null}
            </Tr>
          </THead>
          <TBody>
            {rows.map((row) => (
              <Tr key={row.id}>
                <Td>
                  {linkToFile ? (
                    <Link
                      href={`/app/contratos/${row.id}`}
                      className="cursor-pointer font-medium text-carbon underline-offset-4 transition-colors duration-200 hover:text-accent hover:underline"
                    >
                      {row.reference}
                    </Link>
                  ) : (
                    <span className="font-medium text-carbon">{row.reference}</span>
                  )}
                  <span className="block text-xs text-carbon-soft">{row.templateName}</span>
                </Td>
                <Td>{row.holderName}</Td>
                <Td>{row.signerName}</Td>
                <Td>
                  <StatusBadge status={row.status} />
                </Td>
                <Td>{formatDate(row.issuedAt)}</Td>
                <Td>
                  <Highlighted items={row.highlighted} />
                </Td>
                {renderAction ? <Td>{renderAction(row)}</Td> : null}
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>

      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <Card>
              <CardBody>
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      {linkToFile ? (
                        <Link
                          href={`/app/contratos/${row.id}`}
                          className="cursor-pointer font-medium text-carbon underline-offset-4 transition-colors duration-200 hover:text-accent hover:underline"
                        >
                          {row.reference}
                        </Link>
                      ) : (
                        <span className="font-medium text-carbon">{row.reference}</span>
                      )}
                      <p className="text-xs text-carbon-soft">{row.templateName}</p>
                    </div>
                    <StatusBadge status={row.status} />
                  </div>
                  <p className="text-sm text-ink">{row.holderName}</p>
                  <p className="text-xs text-carbon-soft">
                    Firmante: {row.signerName} · {formatDate(row.issuedAt)}
                  </p>
                  {row.folderName ? (
                    <p className="text-xs text-carbon-soft">Carpeta: {row.folderName}</p>
                  ) : null}
                  <Highlighted items={row.highlighted} />
                  {renderAction ? <div className="pt-1">{renderAction(row)}</div> : null}
                </div>
              </CardBody>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
