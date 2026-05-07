import { describe, it, expect, beforeAll, afterAll, test } from 'vitest';

import { db } from '@/shared/database/client';

describe('createDatabaseClient', () => {
  beforeAll(() => {
    db.$client.connect();
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it('runs a simple SELECT 1', async () => {
    const res = await db.execute(`SELECT 1 as value`);
    expect(res).toBeDefined();
  });
});
