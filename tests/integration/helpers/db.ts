import { afterEach, beforeEach, vi } from 'vitest';
import { db } from '@/shared/database/client';
import type { PgTransaction } from 'drizzle-orm/pg-core';

let currentTx: PgTransaction<any, any, any> | null = null;

export function useDb() {
  beforeEach(async () => {
    currentTx = await db.transaction(async (tx) => {
      return tx;
    });
  });

  afterEach(async () => {
    if (currentTx) {
      currentTx = null;
    }
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
