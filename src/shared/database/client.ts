import { neonConfig, Pool as NeonPool } from '@neondatabase/serverless';
import { drizzle as neonDrizzle, NeonDatabase } from 'drizzle-orm/neon-serverless';
import { drizzle as pgDrizzle } from 'drizzle-orm/node-postgres';
import { Pool as PgPool } from 'pg';

import * as schema from '@/db/schema';

neonConfig.webSocketConstructor = WebSocket;

export type DatabaseClient = NeonDatabase<typeof schema> & {
  $client: NeonPool;
};

let _pool: NeonPool | PgPool | null = null;
export let db: DatabaseClient;
export let isNeonConnection = false;

export const createDatabaseClient = (connectionUrl: string): DatabaseClient => {
  if (_pool) {
    void _pool.end();
  }

  isNeonConnection = connectionUrl.includes('.neon.tech');

  if (isNeonConnection) {
    _pool = new NeonPool({ connectionString: connectionUrl });
    db = neonDrizzle(_pool, { schema }) as DatabaseClient;
  } else {
    _pool = new PgPool({ connectionString: connectionUrl });
    db = pgDrizzle(_pool, { schema }) as unknown as DatabaseClient;
  }

  return db;
};

export const getDatabaseClient = () => {
  if (!db)
    throw new Error(
      'Database client has not been initialized. Please call createDatabaseClient first.',
    );
  return db;
};

export const closeDatabaseClient = async () => {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
};
