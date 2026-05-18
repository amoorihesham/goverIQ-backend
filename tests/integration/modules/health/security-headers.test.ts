import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildAppTestServer } from '../../helpers/server';

let app: Awaited<ReturnType<typeof buildAppTestServer>>;

beforeAll(async () => {
  app = await buildAppTestServer();
});

afterAll(async () => {
  await app.close();
});

describe('Security Headers (FR-512)', () => {
  it('every response carries X-Content-Type-Options: nosniff', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('every response carries X-Frame-Options: DENY', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('Strict-Transport-Security is absent in test/dev', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });
});
