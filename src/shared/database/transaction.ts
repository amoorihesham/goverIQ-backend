import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { NeonQueryResultHKT } from 'drizzle-orm/neon-serverless';
import type { PgTransaction } from 'drizzle-orm/pg-core';

import { getDatabaseClient } from './client';

import * as schema from '@/db/schema';


export type Tx = PgTransaction<
  NeonQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    return fn(tx as unknown as Tx);
  });
}

export function isTx(value: unknown): value is Tx {
  return typeof value === 'object' && value !== null && 'insert' in value;
}
