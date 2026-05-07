import { db } from './client';

export type DatabaseClient = typeof db;

export type Tx = Parameters<DatabaseClient['transaction']>[0] extends (tx: infer T) => any
  ? T
  : never;
