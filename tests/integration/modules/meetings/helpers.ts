import { randomUUID } from 'crypto';

import { eq } from 'drizzle-orm';

import { users } from '@/db/schema/auth';
import { organizations } from '@/db/schema/org';
import { hashPassword } from '@/modules/auth/public';
import { db } from '@/shared/database/client';

type AppLike = { inject(opts: Record<string, unknown>): Promise<{ statusCode: number; json(): any; body: string }> };

export function futureDate(offsetMs = 24 * 60 * 60 * 1000): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

export function uniqueEmail() {
  return `meeting-test-${randomUUID()}@test.example`;
}

export async function createVerifiedUser(email: string, password: string) {
  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(users).values({ email, passwordHash, isVerified: true }).returning();
  return user!;
}

export async function loginUser(app: AppLike, email: string, password: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  if (res.statusCode !== 200) throw new Error(`Login failed: ${res.body}`);
  return res.json().data.accessToken as string;
}

export async function createOrg(app: AppLike, token: string, name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/orgs',
    headers: { authorization: `Bearer ${token}` },
    payload: { name },
  });
  if (res.statusCode !== 201) throw new Error(`Create org failed: ${res.body}`);
  // Org controller wraps: success({ data: org, message: '...' }) → { data: { data: org, message } }
  const body = res.json();
  return (body.data?.data ?? body.data) as { id: string };
}

export async function completeOnboarding(orgId: string) {
  await db.update(organizations).set({ onboardingStep: 'COMPLETE' }).where(eq(organizations.id, orgId));
}

export async function setupMeetingContext(app: AppLike) {
  const email = uniqueEmail();
  const password = 'test-password-123';
  await createVerifiedUser(email, password);
  const token = await loginUser(app, email, password);
  const org = await createOrg(app, token, `Meeting Org ${randomUUID()}`);
  await completeOnboarding(org.id);
  return { token, orgId: org.id };
}
