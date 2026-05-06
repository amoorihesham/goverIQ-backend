import { randomUUID } from 'crypto';

import { eq } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { truncateAuthTables } from '../../helpers/db';
import { buildAuthTestServer } from '../../helpers/server';

import { auditLogs } from '@/db/schema/audit';
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
  return `logout-${randomUUID()}@test.example`;
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
  const match = cookieStr.match(/refresh_token=([^;]+)/);
  return match![1]!;
}

describe('POST /auth/logout (FR-110 / FR-112 / SC-107)', () => {
  it('204 + cookie cleared + DB row gone + user.logout audit row', async () => {
    const email = uniqueEmail();
    const password = 'correct-horse-battery';
    const db = getDatabaseClient();
    const passwordHash = await hashPassword(password);
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, isVerified: true })
      .returning();

    const cookie = await loginAndGetCookie(email, password);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: `refresh_token=${cookie}` },
    });

    expect(res.statusCode).toBe(204);

    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string);
    expect(cookieStr).toContain('Max-Age=0');

    const rows = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, user!.id));
    expect(rows).toHaveLength(0);

    const auditRows = await db.select().from(auditLogs).where(eq(auditLogs.event, 'user.logout'));
    const audit = auditRows.find((r) => r.actorId === user!.id);
    expect(audit).toBeDefined();
  });

  it('204 on second logout with same cookie — idempotent, no additional audit row (SC-107)', async () => {
    const email = uniqueEmail();
    const password = 'correct-horse-battery';
    const db = getDatabaseClient();
    const passwordHash = await hashPassword(password);
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, isVerified: true })
      .returning();

    const cookie = await loginAndGetCookie(email, password);

    await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: `refresh_token=${cookie}` },
    });

    const auditCountBefore = (
      await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.event, 'user.logout'))
    ).filter((r) => r.actorId === user!.id).length;

    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: `refresh_token=${cookie}` },
    });

    expect(res.statusCode).toBe(204);

    const auditCountAfter = (
      await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.event, 'user.logout'))
    ).filter((r) => r.actorId === user!.id).length;

    expect(auditCountAfter).toBe(auditCountBefore);
  });

  it('204 with no cookie — no error, no DB writes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
    });

    expect(res.statusCode).toBe(204);
  });

  it('rotated cookie cannot refresh after logout (FR-110)', async () => {
    const email = uniqueEmail();
    const password = 'correct-horse-battery';
    const db = getDatabaseClient();
    const passwordHash = await hashPassword(password);
    await db.insert(users).values({ email, passwordHash, isVerified: true });

    const cookie = await loginAndGetCookie(email, password);

    // Logout
    await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: `refresh_token=${cookie}` },
    });

    // Subsequent refresh must fail
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: `refresh_token=${cookie}` },
    });

    expect(refreshRes.statusCode).toBe(401);
  });
});
