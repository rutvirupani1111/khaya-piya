// Neon access. A Pool over WebSocket, created per request for transactions (Node runtime route handlers).
import { Pool } from "@neondatabase/serverless";

export type Row = Record<string, unknown>;
export interface Q {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

function url() {
  const u = process.env.DATABASE_URL;
  if (!u) throw new Error("DATABASE_URL is not set");
  return u;
}

/** One-off query: opens a pool, runs, closes. */
export async function sql<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const pool = new Pool({ connectionString: url(), max: 1 });
  try {
    return (await pool.query(text, params)).rows as T[];
  } finally {
    await pool.end();
  }
}

/** A transaction with its own pool, closed at the end of the request. */
export async function tx<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: url(), max: 1 });
  const c = await pool.connect();
  try {
    await c.query("begin");
    const out = await fn({
      async query<R>(text: string, params: unknown[] = []) {
        return (await c.query(text, params)).rows as R[];
      },
    });
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}
