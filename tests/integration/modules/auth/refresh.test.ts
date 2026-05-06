import { randomUUID } from 'crypto';

import { eq } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { truncateAuthTables } from '../../helpers/db';
import { buildAuthTestServer } from '../../helpers/server';

import { refreshTokens, users } from '@/db/schema/auth';
import { hashPassword } from '@/modules/auth/password';
import { getDatabaseClient } from '@/shared/database/client';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildAuthTestServer();
});

beforeEach(truncateAuthTables);

afterAll(async () => {
  await app.close();
});

function uniqueEmail() {
  return `refresh-${randomUUID()}@test.example`;
}

async function loginAndGetCookie(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });
  if (res.statusCode !== 200) throw new Error(`Login failed: ${res.body}`);
  const setCookie = res.headers['set-cookie'];
  const cookieStr = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string);
  // Extract the cookie value (signed)
  const match = cookieStr.match(/refresh_token=([^;]+)/);
  return match![1]!;
}

describe('POST /auth/refresh (FR-108 / FR-109 / SC-103)', () => {
  it('200 with new accessToken + rotated cookie; prior row gone; exactly one row remains', async () => {
    const email = uniqueEmail();
    const password = 'correct-horse-battery';
    const db = getDatabaseClient();
    const passwordHash = await hashPassword(password);
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, isVerified: true })
      .returning();

    const cookieA = await loginAndGetCookie(email, password);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: `refresh_token=${cookieA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.accessToken).toBe('string');

    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string);
    const matchB = cookieStr.match(/refresh_token=([^;]+)/);
    const cookieB = matchB![1]!;
    expect(cookieB).not.toBe(cookieA);

    const rows = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, user!.id));
    expect(rows).toHaveLength(1);
  });

  it('401 UNAUTHORIZED + ALL tokens deleted on replay of rotated cleartext (SC-103)', async () => {
    const email = uniqueEmail();
    const password = 'correct-horse-battery';
    const db = getDatabaseClient();
    const passwordHash = await hashPassword(password);
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, isVerified: true })
      .returning();

    const cookieA = await loginAndGetCookie(email, password);

    // Rotate once
    const rotateRes = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: `refresh_token=${cookieA}` },
    });
    expect(rotateRes.statusCode).toBe(200);

    // Replay the old cookie — theft signal
    const replayRes = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: `refresh_token=${cookieA}` },
    });

    expect(replayRes.statusCode).toBe(401);
    expect(replayRes.json().error.code).toBe('UNAUTHORIZED');

    // All tokens for this user must be gone
    const rows = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, user!.id));
    expect(rows).toHaveLength(0);
  });

  it('401 UNAUTHORIZED when hash matches an expired row — only that row deleted', async () => {
    const email = uniqueEmail();
    const password = 'correct-horse-battery';
    const db = getDatabaseClient();
    const passwordHash = await hashPassword(password);
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, isVerified: true })
      .returning();

    const cookieA = await loginAndGetCookie(email, password);

    // Expire the token row directly
    await db
      .update(refreshTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(refreshTokens.userId, user!.id));

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: `refresh_token=${cookieA}` },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');

    const rows = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, user!.id));
    expect(rows).toHaveLength(0);
  });

  it('401 UNAUTHORIZED with no cookie — no DB writes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('401 UNAUTHORIZED for malformed cookie shape — no cascade', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: 'refresh_token=s%3Amalformed-value.fakesig' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });
});
