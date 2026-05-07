import { db } from './client';
import { Tx } from './types';

export type { Tx };

export const withTx = async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
  return db.transaction(async (tx) => {
    return fn(tx);
  });
};
