import type { PgTransaction } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach } from 'vitest';

import { getDatabaseClient } from '@/shared/database/client';

let currentTx: PgTransaction<any, any, any> | null = null;
let rejectTx: ((err: Error) => void) | null = null;

export function useDb() {
  beforeEach(async () => {
    const db = getDatabaseClient();
    await new Promise<void>((readyResolve) => {
      db.transaction(async (tx) => {
        currentTx = tx;
        readyResolve();
        await new Promise<void>((_, reject) => {
          rejectTx = reject;
        });
      }).catch(() => {
      });
    });
  });

  afterEach(async () => {
    rejectTx?.(new Error('rollback'));
    currentTx = null;
    rejectTx = null;
  });

  return {
    get tx() {
      if (!currentTx) {
        throw new Error('Transaction not initialized. Make sure useDb() is called in the test.');
      }
      return currentTx;
    },
  };
}
