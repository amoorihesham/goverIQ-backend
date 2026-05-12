import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { env } from '../config/env';

import { instrumentPool } from './instrumentation';

import * as schema from '@/db/schema';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX_SIZE,
});

instrumentPool(pool);

export const db = drizzle({ client: pool, schema });
