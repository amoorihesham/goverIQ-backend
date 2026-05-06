import { randomUUID } from 'crypto';

import { eq } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { truncateAuthTables } from '../../helpers/db';
import { buildAuthTestServer } from '../../helpers/server';

import { auditLogs } from '@/db/schema/audit';
import { emailVerifications, users } from '@/db/schema/auth';
import { hashOtp } from '@/modules/auth/otp';
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
  return `verify-${randomUUID()}@test.example`;
}

async function registerAndGetOtp(email: string): Promise<string> {
  // Insert user + verification row directly for deterministic OTP
  const db = getDatabaseClient();
  const otp = '123456';
  const otpHash = hashOtp(otp);
  const passwordHash = await hashPassword('correct-horse-battery');

  const [user] = await db
    .insert(users)
    .values({ email, passwordHash, isVerified: false })
    .returning();

  await db.insert(emailVerifications).values({
    userId: user!.id,
    otpHash,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    lastSentAt: new Date(),
  });

  return otp;
}

describe('POST /auth/verify-email (FR-104 / FR-112)', () => {
  it('200 with accessToken + Set-Cookie + user verified + verification deleted + audit', async () => {
    const email = uniqueEmail();
    const otp = await registerAndGetOtp(email);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { email, otp },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.accessToken).toBe('string');

    // Cookie set
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie as string);
    expect(cookieHeader).toContain('refresh_token');
    expect(cookieHeader).toContain('HttpOnly');

    const db = getDatabaseClient();

    // User is verified
    const [user] = await db.select().from(users).where(eq(users.email, email));
    expect(user?.isVerified).toBe(true);

    // Verification row deleted
    const verRows = await db
      .select()
      .from(emailVerifications)
      .where(eq(emailVerifications.userId, user!.id));
    expect(verRows).toHaveLength(0);

    // Audit row present
    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.event, 'user.verified'));
    const audit = auditRows.find(
      (r) => (r.payload as { data: { email: string } }).data?.email === email,
    );
    expect(audit).toBeDefined();
  });

  it('422 OTP_EXPIRED when OTP is past expiry', async () => {
    const email = uniqueEmail();
    const db = getDatabaseClient();
    const otp = '654321';
    const otpHash = hashOtp(otp);
    const passwordHash = await hashPassword('correct-horse-battery');

    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, isVerified: false })
      .returning();

    await db.insert(emailVerifications).values({
      userId: user!.id,
      otpHash,
      expiresAt: new Date(Date.now() - 1000), // already expired
      lastSentAt: new Date(Date.now() - 15 * 60 * 1000),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { email, otp },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('OTP_EXPIRED');

    const [stillUser] = await db.select().from(users).where(eq(users.email, email));
    expect(stillUser?.isVerified).toBe(false);
  });

  it('401 INVALID_CREDENTIALS for wrong OTP', async () => {
    const email = uniqueEmail();
    await registerAndGetOtp(email);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { email, otp: '000000' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');

    const db = getDatabaseClient();
    const [user] = await db.select().from(users).where(eq(users.email, email));
    expect(user?.isVerified).toBe(false);
  });
});
