import { neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle, NeonDatabase } from 'drizzle-orm/neon-serverless';

import * as schema from '@/db/schema';

// Node.js v21+ has native WebSocket; required for Pool/transaction support
neonConfig.webSocketConstructor = WebSocket;

export type DatabaseClient = NeonDatabase<typeof schema> & {
  $client: Pool;
};

let _pool: Pool | null = null;
export let db: DatabaseClient;

export const createDatabaseClient = (connectionUrl: string) => {
  if (_pool) {
    void _pool.end();
  }
  _pool = new Pool({ connectionString: connectionUrl });
  db = drizzle(_pool, { schema }) as DatabaseClient;
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
