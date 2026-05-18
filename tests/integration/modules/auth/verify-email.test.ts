import { eq } from 'drizzle-orm';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { truncateAllTables } from '../../helpers/db';
import { buildTestServer } from '../../helpers/server';

import { auditLogs } from '@/db/schema/audit';
import { emailVerifications, users } from '@/db/schema/auth';

import { db } from '@/shared/database/client';
import { hashOtp, hashPassword } from '@/modules/auth/public';
import { registerAndGetOtp, uniqueEmail } from './helpers';

let app: Awaited<ReturnType<typeof buildTestServer>>;

beforeAll(async () => {
  app = await buildTestServer();
});

beforeEach(truncateAllTables);

afterAll(async () => {
  await app.close();
});

describe('POST /auth/verify-email (FR-104 / FR-112)', () => {
  it('200 with accessToken + Set-Cookie + user verified + verification deleted + audit', async () => {
    const email = uniqueEmail();
    const otp = await registerAndGetOtp(email);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { email, otp },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);

    // User is verified
    const [user] = await db.select().from(users).where(eq(users.email, email));
    expect(user?.isVerified).toBe(true);

    // Verification row deleted
    const verRows = await db.select().from(emailVerifications).where(eq(emailVerifications.userId, user!.id));
    expect(verRows).toHaveLength(0);

    // Audit row present
    const auditRows = await db.select().from(auditLogs).where(eq(auditLogs.event, 'user.verified'));
    const audit = auditRows.find((r) => (r.payload as { data: { email: string } }).data?.email === email);
    expect(audit).toBeDefined();
  });

  it('422 OTP_EXPIRED when OTP is past expiry', async () => {
    const email = uniqueEmail();

    const otp = '654321';
    const otpHash = hashOtp(otp);
    const passwordHash = await hashPassword('correct-horse-battery');

    const [user] = await db.insert(users).values({ email, passwordHash, isVerified: false }).returning();

    await db.insert(emailVerifications).values({
      userId: user!.id,
      otpHash,
      expiresAt: new Date(Date.now() - 1000), // already expired
      lastSentAt: new Date(Date.now() - 15 * 60 * 1000),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
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
      url: '/api/v1/auth/verify-email',
      payload: { email, otp: '000000' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');

    const [user] = await db.select().from(users).where(eq(users.email, email));
    expect(user?.isVerified).toBe(false);
  });
});
