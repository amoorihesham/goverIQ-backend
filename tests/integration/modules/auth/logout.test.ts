import { eq } from 'drizzle-orm';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { auditLogs } from '@/db/schema/audit';
import { refreshTokens, users } from '@/db/schema/auth';

import { db } from '@/shared/database/client';
import { buildTestServer } from '../../helpers/server';
import { truncateAllTables } from '../../helpers/db';
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

describe('POST /auth/logout (FR-110 / FR-112 / SC-107)', () => {
  it('204 + cookie cleared + DB row gone + user.logout audit row', async () => {
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
      url: '/api/v1/auth/logout',
      headers: { cookie: `refresh_token=${tokenA.split('=')[1]}` },
    });

    expect(res.statusCode).toBe(204);

    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string);
    expect(cookieStr).toContain('Max-Age=0');

    const rows = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, user!.id));
    expect(rows).toHaveLength(0);

    const auditRows = await db.select().from(auditLogs).where(eq(auditLogs.event, 'user.logout'));
    const audit = auditRows.find((r) => r.actorId === user!.id);
    expect(audit).toBeDefined();
  });

  it('204 on second logout with same cookie — idempotent, no additional audit row (SC-107)', async () => {
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

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: `refresh_token=${tokenA.split('=')[1]}` },
    });

    const auditCountBefore = (await db.select().from(auditLogs).where(eq(auditLogs.event, 'user.logout'))).filter(
      (r) => r.actorId === user!.id,
    ).length;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: `refresh_token=${tokenA.split('=')[1]}` },
    });

    expect(res.statusCode).toBe(204);

    const auditCountAfter = (await db.select().from(auditLogs).where(eq(auditLogs.event, 'user.logout'))).filter(
      (r) => r.actorId === user!.id,
    ).length;

    expect(auditCountAfter).toBe(auditCountBefore);
  });

  it('204 with no cookie — no error, no DB writes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
    });

    expect(res.statusCode).toBe(204);
  });

  it('rotated cookie cannot refresh after logout (FR-110)', async () => {
    const email = uniqueEmail();
    const password = 'correct-horse-battery';

    const passwordHash = await hashPassword(password);
    await db.insert(users).values({ email, passwordHash, isVerified: true });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });

    const refToken = loginRes.headers['set-cookie'];
    if (!refToken || typeof refToken === 'string') throw AppError.internalError();

    const tokenA = refToken[0].split(';')[0];

    // Logout
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: `refresh_token=${tokenA.split('=')[1]}` },
    });

    // Subsequent refresh must fail
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: `refresh_token=${tokenA.split('=')[1]}` },
    });

    expect(refreshRes.statusCode).toBe(401);
  });
});
