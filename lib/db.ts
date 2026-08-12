import "server-only";
import postgres from "postgres";

const globalForDb = globalThis as unknown as {
  fidesSql?: postgres.Sql;
};

export const DEFAULT_DATABASE_URL =
  "postgres://fides:fides_local_only@127.0.0.1:54329/fides";

export const sql: postgres.Sql =
  globalForDb.fidesSql ??
  postgres(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, {
    max: 10,
    onnotice: () => undefined,
    transform: { undefined: null },
    connection: { search_path: "fides,public" },
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.fidesSql = sql;
}

export type Sql = postgres.Sql;
export type Transaction = postgres.TransactionSql;
