import { describe, it, expect, beforeAll, afterAll, test } from 'vitest';

import {
  createDatabaseClient,
  closeDatabaseClient,
  getDatabaseClient,
} from '@/shared/database/client';

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!url) {
  test.skip('No database URL provided; skipping DB client tests', () => {});
} else {
  describe('createDatabaseClient', () => {
    beforeAll(() => {
      createDatabaseClient(url);
    });

    afterAll(async () => {
      await closeDatabaseClient();
    });

    it('runs a simple SELECT 1', async () => {
      const db: any = getDatabaseClient();
      // Using raw query across Drizzle variants for a portability check
      const res = await db.$queryRaw`SELECT 1 as value`;
      expect(res).toBeDefined();
    });
  });
}
