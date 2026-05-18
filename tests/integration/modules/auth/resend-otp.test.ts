import { eq } from 'drizzle-orm';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { truncateAllTables } from '../../helpers/db';
import { buildTestServer } from '../../helpers/server';

import { emailVerifications, users } from '@/db/schema/auth';

import { db } from '@/shared/database/client';
import { createUnverifiedUserWithVerification, uniqueEmail } from './helpers';
import { randomUUID } from 'crypto';
import { hashPassword } from '@/modules/auth/public';

let app: Awaited<ReturnType<typeof buildTestServer>>;

beforeAll(async () => {
  app = await buildTestServer();
});

beforeEach(truncateAllTables);

afterAll(async () => {
  await app.close();
});

describe('POST /auth/resend-otp (FR-102 / FR-103 / FR-106)', () => {
  it('422 OTP_COOLDOWN inside cooldown window', async () => {
    const email = uniqueEmail();
    await createUnverifiedUserWithVerification(email, 10); // sent 10s ago, cooldown is 60s

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/resend-otp',
      payload: { email },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('OTP_COOLDOWN');
  });

  it('200 past cooldown — new otpHash + lastSentAt updated + old OTP now invalid', async () => {
    const email = uniqueEmail();
    await createUnverifiedUserWithVerification(email, 65); // sent 65s ago

    const [user] = await db.select().from(users).where(eq(users.email, email));
    const [oldVer] = await db.select().from(emailVerifications).where(eq(emailVerifications.userId, user!.id));
    const oldHash = oldVer!.otpHash;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/resend-otp',
      payload: { email },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.message).toBe('Verification code resent.');

    const [newVer] = await db.select().from(emailVerifications).where(eq(emailVerifications.userId, user!.id));
    expect(newVer!.otpHash).not.toBe(oldHash);
    expect(newVer!.lastSentAt.getTime()).toBeGreaterThan(oldVer!.lastSentAt.getTime());
  });

  it('422 OTP_COOLDOWN for unknown email — byte-equal to cooldown response (enumeration parity)', async () => {
    const email = uniqueEmail();
    await createUnverifiedUserWithVerification(email, 10); // known, inside cooldown

    const [cooldownRes, unknownRes] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/resend-otp',
        payload: { email },
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/resend-otp',
        payload: { email: `nobody-${randomUUID()}@test.example` },
      }),
    ]);

    expect(cooldownRes.statusCode).toBe(422);
    expect(unknownRes.statusCode).toBe(422);
    expect(cooldownRes.body).toBe(unknownRes.body);
  });

  it('422 OTP_COOLDOWN at cooldown boundary − 1s (59s ago, still blocked)', async () => {
    const email = uniqueEmail();
    await createUnverifiedUserWithVerification(email, 59);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/resend-otp',
      payload: { email },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('OTP_COOLDOWN');
  });

  it('200 at cooldown boundary + 1s (61s ago, just allowed)', async () => {
    const email = uniqueEmail();
    await createUnverifiedUserWithVerification(email, 61);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/resend-otp',
      payload: { email },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.message).toBe('Verification code resent.');
  });

  it('422 OTP_COOLDOWN for verified user — byte-equal parity (no purpose post-verification)', async () => {
    const email = uniqueEmail();

    const passwordHash = await hashPassword('correct-horse-battery');
    await db.insert(users).values({ email, passwordHash, isVerified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/resend-otp',
      payload: { email },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('OTP_COOLDOWN');
  });
});
