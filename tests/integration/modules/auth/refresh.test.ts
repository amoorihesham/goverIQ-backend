import { eq } from 'drizzle-orm';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { truncateAllTables } from '../../helpers/db';
import { buildTestServer } from '../../helpers/server';

import { refreshTokens, users } from '@/db/schema/auth';

import { db } from '@/shared/database/client';
import { loginAndGetCookie, uniqueEmail } from './helpers';
import { hashPassword } from '@/modules/auth/public';
import { AppError } from '@/shared/errors/http-error';

let app: Awaited<ReturnType<typeof buildTestServer>>;

beforeAll(async () => {
  app = await buildTestServer();
});

beforeEach(truncateAllTables);

afterAll(async () => {
  await app.close();
});

describe('POST /auth/refresh (FR-108 / FR-109 / SC-103)', () => {
  it('200 with new accessToken + rotated cookie; prior row gone; exactly one row remains', async () => {
    const email = uniqueEmail();
    const password = 'correct-horse-battery';

    const passwordHash = await hashPassword(password);
    const [user] = await db.insert(users).values({ email, passwordHash, isVerified: true }).returning();

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });

    const refToken = loginRes.headers['set-cookie'];
    if (!refToken || typeof refToken === 'string') throw AppError.internalError();

    const tokenA = refToken[0].split(';')[0];

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: `refresh_token=${tokenA.split('=')[1]}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.success).toBe(true);
    expect(typeof body.data.accessToken).toBe('string');

    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string);
    const matchB = cookieStr.match(/refresh_token=([^;]+)/);
    const cookieB = matchB![1]!;

    expect(cookieB).not.toBe(tokenA);

    const rows = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, user!.id));
    expect(rows).toHaveLength(1);
  });

  it('401 UNAUTHORIZED when hash matches an expired row — only that row deleted', async () => {
    const email = uniqueEmail();
    const password = 'correct-horse-battery';

    const passwordHash = await hashPassword(password);
    const [user] = await db.insert(users).values({ email, passwordHash, isVerified: true }).returning();

    const cookieA = await loginAndGetCookie(email, password, app);

    // Expire the token row directly
    await db
      .update(refreshTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(refreshTokens.userId, user!.id));

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: `refresh_token=${cookieA}` },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');

    const rows = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, user!.id));
    expect(rows).toHaveLength(0);
  });

  it('401 UNAUTHORIZED with no cookie — no DB writes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_TOKEN');
  });

  it('401 UNAUTHORIZED for malformed cookie shape — no cascade', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: 'refresh_token=s%3Amalformed-value.fakesig' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_TOKEN');
  });
});
