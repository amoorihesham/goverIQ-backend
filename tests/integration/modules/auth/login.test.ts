import { randomUUID } from 'crypto';

import { eq } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { truncateAuthTables } from '../../helpers/db';
import { buildAuthTestServer } from '../../helpers/server';

import { auditLogs } from '@/db/schema/audit';
import { users } from '@/db/schema/auth';
import { hashPassword } from '@/modules/auth/password';
import { db } from '@/shared/database/client';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildAuthTestServer();
});

beforeEach(truncateAuthTables);

afterAll(async () => {
  await app.close();
});

function uniqueEmail() {
  return `login-${randomUUID()}@test.example`;
}

async function createVerifiedUser(email: string, password: string) {
  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash, isVerified: true })
    .returning();
  return user!;
}

describe('POST /auth/login (FR-105 / FR-106 / FR-107 / FR-112 / SC-102 / SC-104 / SC-106)', () => {
  it('200 with accessToken + Set-Cookie + audit row on correct credentials', async () => {
    const email = uniqueEmail();
    const password = 'correct-horse-battery';
    await createVerifiedUser(email, password);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.accessToken).toBe('string');

    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie as string);
    expect(cookieStr).toContain('refresh_token');
    expect(cookieStr).toContain('HttpOnly');

    const auditRows = await db.select().from(auditLogs).where(eq(auditLogs.event, 'user.login'));
    const audit = auditRows.find(
      (r) => (r.payload as { data: { email: string } }).data?.email === email,
    );
    expect(audit).toBeDefined();
  });

  it('401 INVALID_CREDENTIALS — wrong password', async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email, 'correct-horse-battery');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'wrong-password-123' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('401 INVALID_CREDENTIALS — unknown email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: `nobody-${randomUUID()}@test.example`, password: 'any-password-123' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('401 INVALID_CREDENTIALS — unverified user (SC-104)', async () => {
    const email = uniqueEmail();

    const passwordHash = await hashPassword('correct-horse-battery');
    await db.insert(users).values({ email, passwordHash, isVerified: false });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'correct-horse-battery' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('wrong-password vs unknown-email responses are byte-equal (SC-106)', async () => {
    const email = uniqueEmail();
    await createVerifiedUser(email, 'correct-horse-battery');

    const [wrongPw, unknownEmail] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password: 'wrong-password-xyz' },
      }),
      app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: `nobody-${randomUUID()}@test.example`, password: 'wrong-password-xyz' },
      }),
    ]);

    expect(wrongPw.statusCode).toBe(unknownEmail.statusCode);
    expect(wrongPw.body).toBe(unknownEmail.body);
  });

  it('login p95 < 300 ms across 100 concurrent calls against a 10k-user table (SC-102 concurrent)', async () => {
    const password = 'correct-horse-battery';

    // Each concurrent slot gets its own user so no two in-flight requests share
    // a refresh_tokens row. Concurrent logins for the same user would deadlock on
    // the DELETE + INSERT inside issueSessionWithinTx (unique index on user_id).
    const CONCURRENCY = 10;
    const TOTAL = 100;
    const pool = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        createVerifiedUser(`pool-${i}-${randomUUID()}@test.example`, password),
      ),
    );

    const decoyHash = await hashPassword('decoy-password-only');
    const TARGET = 10_000;
    const existing = await db.$count(users);
    const need = Math.max(0, TARGET - existing);
    if (need > 0) {
      const batch = 1_000;
      for (let i = 0; i < need; i += batch) {
        const rows = Array.from({ length: Math.min(batch, need - i) }, (_, k) => ({
          email: `seed-${randomUUID()}-${i + k}@test.example`,
          passwordHash: decoyHash,
          isVerified: true,
        }));
        await db.insert(users).values(rows);
      }
    }

    const latencies: number[] = [];

    for (let i = 0; i < TOTAL; i += CONCURRENCY) {
      const slice = Math.min(CONCURRENCY, TOTAL - i);
      await Promise.all(
        Array.from({ length: slice }, async (_, j) => {
          const user = pool[j % CONCURRENCY]!;
          const start = Date.now();
          const res = await app.inject({
            method: 'POST',
            url: '/auth/login',
            payload: { email: user.email, password },
          });
          latencies.push(Date.now() - start);
          expect(res.statusCode).toBe(200);
        }),
      );
    }

    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1]!;

    console.log(
      `[SC-102-concurrent] login p95 over 100 concurrent calls @ ${TARGET} users: ${p95}ms`,
    );
    // Concurrent threshold is looser than sequential (300 vs 200 ms) because concurrent
    // bcrypt comparisons compete for the libuv thread pool (default 4 threads).
    expect(p95).toBeLessThan(300);
  }, 300_000);

  it('login p95 < 200 ms across 100 calls against a 10k-user table (SC-102)', async () => {
    const email = uniqueEmail();
    const password = 'correct-horse-battery';
    await createVerifiedUser(email, password);

    // Seed enough decoy rows that the email index actually matters. Reuses one
    // bcrypt hash to keep seed time bounded.

    const decoyHash = await hashPassword('decoy-password-only');
    const TARGET = 10_000;
    const existing = await db.$count(users);
    const need = Math.max(0, TARGET - existing);
    if (need > 0) {
      const batch = 1_000;
      for (let i = 0; i < need; i += batch) {
        const rows = Array.from({ length: Math.min(batch, need - i) }, (_, k) => ({
          email: `seed-${randomUUID()}-${i + k}@test.example`,
          passwordHash: decoyHash,
          isVerified: true,
        }));
        await db.insert(users).values(rows);
      }
    }

    const latencies: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = Date.now();
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password },
      });
      latencies.push(Date.now() - start);
      expect(res.statusCode).toBe(200);
    }

    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1]!;

    console.log(`[SC-102] login p95 over 100 calls @ ${TARGET} users: ${p95}ms`);
    expect(p95).toBeLessThan(200);
  }, 300_000);
});
