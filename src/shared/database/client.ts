import { NeonQueryFunction } from '@neondatabase/serverless';
import { drizzle, NeonHttpDatabase } from 'drizzle-orm/neon-http';

import * as schema from '@/db/schema';

export type DatabaseClient = NeonHttpDatabase<typeof schema> & {
  $client: NeonQueryFunction<any, any>;
};

let db: DatabaseClient | null = null;

export const createDatabaseClient = (connectionUrl: string) => {
  db = drizzle(connectionUrl, { schema });
  return db;
};

export const getDatabaseClient = () => {
  if (!db)
    throw new Error(
      'Database client has not been initialized. Please call createDatabaseClient first.',
    );

  return db;
};
