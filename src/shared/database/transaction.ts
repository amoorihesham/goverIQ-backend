import type { PgTransaction } from 'drizzle-orm/pg-core';

import { db } from './client';

declare const __tx_brand: unique symbol;

export type Tx = PgTransaction<any, any, any> & { [__tx_brand]: true };

export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const brandedTx = tx as unknown as Tx;
    return fn(brandedTx);
  });
}

export function isTx(value: unknown): value is Tx {
  return (
    typeof value === 'object' &&
    value !== null &&
    __tx_brand in value
  );
}
