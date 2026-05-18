import { emailVerifications, users } from '@/db/schema';
import { hashOtp, hashPassword } from '@/modules/auth/public';
import { db } from '@/shared/database/client';
import { randomUUID } from 'crypto';
import { buildTestServer } from '../../helpers/server';

export function uniqueEmail() {
  return `reg-${randomUUID()}@test.example`;
}

export async function createVerifiedUser(email: string, password: string) {
  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(users).values({ email, passwordHash, isVerified: true }).returning();
  return user!;
}

export async function registerAndGetOtp(email: string): Promise<string> {
  const otp = '123456';
  const otpHash = hashOtp(otp);
  const passwordHash = await hashPassword('correct-horse-battery');

  const [user] = await db.insert(users).values({ email, passwordHash, isVerified: false }).returning();

  await db.insert(emailVerifications).values({
    userId: user!.id,
    otpHash,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    lastSentAt: new Date(),
  });

  return otp;
}

export async function createUnverifiedUserWithVerification(email: string, lastSentSecondsAgo = 0) {
  const passwordHash = await hashPassword('correct-horse-battery');
  const [user] = await db.insert(users).values({ email, passwordHash, isVerified: false }).returning();

  await db.insert(emailVerifications).values({
    userId: user!.id,
    otpHash: hashOtp('123456'),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    lastSentAt: new Date(Date.now() - lastSentSecondsAgo * 1000),
  });

  return user!;
}

export async function loginAndGetCookie(
  email: string,
  password: string,
  app: Awaited<ReturnType<typeof buildTestServer>>,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  if (res.statusCode !== 200) throw new Error(`Login failed: ${res.body}`);
  const setCookie = res.headers['set-cookie'];
  const cookieStr = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string);
  // Extract the cookie value (signed)
  const match = cookieStr.match(/refresh_token=([^;]+)/);
  return match![1]!;
}
