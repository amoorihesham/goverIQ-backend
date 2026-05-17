import { performance } from 'node:perf_hooks';

import type { Pool, PoolClient } from 'pg';

import { env } from '../config/env';
import { logger } from '../logger';

const THRESHOLD_MS = env.DB_SLOW_QUERY_THRESHOLD_MS;
const ENABLED = env.NODE_ENV !== 'test';

type QueryArg = string | { text: string };

export function instrumentPool(pool: Pool): void {
  if (!ENABLED) return;
  wrapQuery(pool);
  pool.on('connect', (client) => wrapQuery(client));
}

function wrapQuery(target: Pool | PoolClient): void {
  const original = target.query.bind(target) as (...args: unknown[]) => unknown;
  (target as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]): unknown => {
    const start = performance.now();
    const sql = extractSql(args[0] as QueryArg);
    const result = original(...args);
    if (isPromiseLike(result)) {
      return Promise.resolve(result).finally(() => {
        const duration = performance.now() - start;
        if (duration > THRESHOLD_MS) {
          logger.warn({ duration_ms: Math.round(duration), sql }, 'slow query');
        }
      });
    }
    return result;
  };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

function extractSql(arg: QueryArg): string {
  if (typeof arg === 'string') return arg;
  if (arg && typeof arg === 'object' && 'text' in arg) return arg.text;
  return '<unknown>';
}
