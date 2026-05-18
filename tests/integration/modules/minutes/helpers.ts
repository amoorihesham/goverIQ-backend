import { randomUUID } from 'crypto';

import { and, eq } from 'drizzle-orm';

import { users } from '@/db/schema/auth';
import { meetings } from '@/db/schema/meeting';
import { organizations, memberships } from '@/db/schema/org';
import { votes, voteEligibility } from '@/db/schema/vote';
import { hashPassword } from '@/modules/auth/public';
import { db } from '@/shared/database/client';

type AppLike = { inject(opts: Record<string, unknown>): Promise<{ statusCode: number; json(): any; body: string }> };

export function uniqueEmail() {
  return `minutes-test-${randomUUID()}@test.example`;
}

export function nearFutureDate(offsetMs = 60 * 1000): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

export async function createVerifiedUser(email: string, password: string) {
  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(users).values({ email, passwordHash, isVerified: true }).returning();
  return user!;
}

export async function loginUser(app: AppLike, email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  if (res.statusCode !== 200) throw new Error(`Login failed: ${res.body}`);
  return res.json().data.accessToken as string;
}

export async function createOrg(app: AppLike, token: string, name: string): Promise<{ id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/orgs',
    headers: { authorization: `Bearer ${token}` },
    payload: { name },
  });
  if (res.statusCode !== 201) throw new Error(`Create org failed: ${res.body}`);
  const body = res.json();
  return (body.data?.data ?? body.data) as { id: string };
}

export async function completeOnboarding(orgId: string) {
  await db.update(organizations).set({ onboardingStep: 'COMPLETE' }).where(eq(organizations.id, orgId));
}

export async function getMembershipId(userId: string, orgId: string): Promise<string> {
  const [m] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)))
    .limit(1);
  if (!m) throw new Error('Membership not found');
  return m.id;
}

export async function setupMinutesContext(app: AppLike) {
  const email = uniqueEmail();
  const password = 'test-password-123';
  const user = await createVerifiedUser(email, password);
  const token = await loginUser(app, email, password);
  const org = await createOrg(app, token, `Minutes Org ${randomUUID()}`);
  await completeOnboarding(org.id);
  const memberId = await getMembershipId(user.id, org.id);

  // Create a COMPLETED meeting directly via DB to avoid timing constraints
  const [meeting] = await db
    .insert(meetings)
    .values({
      orgId: org.id,
      title: `Minutes Test Meeting ${randomUUID()}`,
      scheduledAt: new Date(Date.now() - 60_000),
      status: 'COMPLETED',
    })
    .returning();
  if (!meeting) throw new Error('Failed to create meeting');

  // Insert a CLOSED vote directly (using affirmative_option column)
  const [vote] = await db
    .insert(votes)
    .values({
      meetingId: meeting.id,
      question: 'Should we approve the budget?',
      options: ['Yes', 'No'],
      affirmativeOption: 'Yes',
      status: 'CLOSED',
      outcome: 'PASSED',
      resultSummary: JSON.stringify({
        outcome: 'PASSED',
        winner: 'Yes',
        totalEligible: 1,
        totalCast: 1,
        optionCounts: { Yes: 1, No: 0 },
      }),
      closedAt: new Date(),
    })
    .returning();
  if (!vote) throw new Error('Failed to create vote');

  // Insert eligibility row so the vote is properly scoped
  await db.insert(voteEligibility).values({ voteId: vote.id, memberId });

  return { token, orgId: org.id, meetingId: meeting.id, memberId, userId: user.id, voteId: vote.id };
}
