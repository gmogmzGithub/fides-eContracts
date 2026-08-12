import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";
import { cx } from "@/components/ui/cx";

export interface TableProps {
  children: ReactNode;
  /** Se aplica al contenedor; por ejemplo `hidden md:block` en listas móviles. */
  className?: string;
}

export function Table({ children, className }: TableProps) {
  return (
    <div
      className={cx(
        "w-full overflow-x-auto rounded-xl border border-line bg-white shadow-sm",
        className
      )}
    >
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  );
}

export function THead({ children, className }: TableProps) {
  return (
    <thead className={cx("bg-[#f5f5f4] text-carbon-soft", className)}>{children}</thead>
  );
}

export function TBody({ children, className }: TableProps) {
  return (
    <tbody className={cx("divide-y divide-line", className)}>{children}</tbody>
  );
}

export interface TrProps extends TableProps {
  interactive?: boolean;
}

export function Tr({ children, className, interactive }: TrProps) {
  return (
    <tr
      className={cx(
        "transition-colors duration-200",
        interactive && "hover:bg-[#faf9f7]",
        className
      )}
    >
      {children}
    </tr>
  );
}

export function Th({
  children,
  className,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cx(
        "px-4 py-3 text-xs font-semibold tracking-wide uppercase whitespace-nowrap",
        className
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cx("px-4 py-3 align-middle text-carbon", className)} {...rest}>
      {children}
    </td>
  );
}
