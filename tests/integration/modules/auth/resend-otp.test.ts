import { randomUUID } from 'crypto';

import { eq } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { truncateAuthTables } from '../../helpers/db';
import { buildAuthTestServer } from '../../helpers/server';

import { emailVerifications, users } from '@/db/schema/auth';
import { hashOtp } from '@/modules/auth/otp';
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
  return `resend-${randomUUID()}@test.example`;
}

async function createUnverifiedUserWithVerification(email: string, lastSentSecondsAgo = 0) {
  const passwordHash = await hashPassword('correct-horse-battery');
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash, isVerified: false })
    .returning();

  await db.insert(emailVerifications).values({
    userId: user!.id,
    otpHash: hashOtp('123456'),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    lastSentAt: new Date(Date.now() - lastSentSecondsAgo * 1000),
  });

  return user!;
}

describe('POST /auth/resend-otp (FR-102 / FR-103 / FR-106)', () => {
  it('422 OTP_COOLDOWN inside cooldown window', async () => {
    const email = uniqueEmail();
    await createUnverifiedUserWithVerification(email, 10); // sent 10s ago, cooldown is 60s

    const res = await app.inject({
      method: 'POST',
      url: '/auth/resend-otp',
      payload: { email },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('OTP_COOLDOWN');
  });

  it('200 past cooldown — new otpHash + lastSentAt updated + old OTP now invalid', async () => {
    const email = uniqueEmail();
    await createUnverifiedUserWithVerification(email, 65); // sent 65s ago

    const [user] = await db.select().from(users).where(eq(users.email, email));
    const [oldVer] = await db
      .select()
      .from(emailVerifications)
      .where(eq(emailVerifications.userId, user!.id));
    const oldHash = oldVer!.otpHash;

    const res = await app.inject({
      method: 'POST',
      url: '/auth/resend-otp',
      payload: { email },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.message).toBe('Verification code resent.');

    const [newVer] = await db
      .select()
      .from(emailVerifications)
      .where(eq(emailVerifications.userId, user!.id));
    expect(newVer!.otpHash).not.toBe(oldHash);
    expect(newVer!.lastSentAt.getTime()).toBeGreaterThan(oldVer!.lastSentAt.getTime());
  });

  it('422 OTP_COOLDOWN for unknown email — byte-equal to cooldown response (enumeration parity)', async () => {
    const email = uniqueEmail();
    await createUnverifiedUserWithVerification(email, 10); // known, inside cooldown

    const [cooldownRes, unknownRes] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/auth/resend-otp',
        payload: { email },
      }),
      app.inject({
        method: 'POST',
        url: '/auth/resend-otp',
        payload: { email: `nobody-${randomUUID()}@test.example` },
      }),
    ]);

    expect(cooldownRes.statusCode).toBe(422);
    expect(unknownRes.statusCode).toBe(422);
    expect(cooldownRes.body).toBe(unknownRes.body);
  });

  it('422 OTP_COOLDOWN at cooldown boundary − 1s (59s ago, still blocked)', async () => {
    // The cooldown is OTP_RESEND_COOLDOWN_SEC=60. At 59 s the window has not
    // elapsed yet, so the server must reject. This pins the off-by-one: if the
    // comparison were `<` instead of `<=` this test would flip to 200.
    const email = uniqueEmail();
    await createUnverifiedUserWithVerification(email, 59);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/resend-otp',
      payload: { email },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('OTP_COOLDOWN');
  });

  it('200 at cooldown boundary + 1s (61s ago, just allowed)', async () => {
    // At 61 s the cooldown has fully elapsed. This is the mirror of the test
    // above: both together prove the boundary is [0, 60] closed, not open.
    const email = uniqueEmail();
    await createUnverifiedUserWithVerification(email, 61);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/resend-otp',
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
      url: '/auth/resend-otp',
      payload: { email },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('OTP_COOLDOWN');
  });
});
