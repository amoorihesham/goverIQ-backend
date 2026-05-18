import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildAppTestServer } from '../../helpers/server';

let app: Awaited<ReturnType<typeof buildAppTestServer>>;

beforeAll(async () => {
  app = await buildAppTestServer();
});

afterAll(async () => {
  await app.close();
});

describe('Health Endpoints (FR-513)', () => {
  it('/health/live returns 200 { status: "live", timestamp } with no auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('live');
    expect(typeof body.timestamp).toBe('string');
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it('/health/ready returns 200 { status: "ready", timestamp } when DB is reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ready');
    expect(typeof body.timestamp).toBe('string');
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});
