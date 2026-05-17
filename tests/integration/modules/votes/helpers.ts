import { randomUUID } from 'crypto';

import { and, eq } from 'drizzle-orm';

import { users } from '@/db/schema/auth';
import { organizations, memberships } from '@/db/schema/org';
import { hashPassword } from '@/modules/auth/public';
import { db } from '@/shared/database/client';

type AppLike = { inject(opts: Record<string, unknown>): Promise<{ statusCode: number; json(): any; body: string }> };

export function uniqueEmail() {
  return `vote-test-${randomUUID()}@test.example`;
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

export async function createMeeting(app: AppLike, token: string, orgId: string): Promise<{ id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/meetings/org/${orgId}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { title: `Vote Test Meeting ${randomUUID()}`, scheduledAt: nearFutureDate() },
  });
  if (res.statusCode !== 201) throw new Error(`Create meeting failed: ${res.body}`);
  return res.json().data as { id: string };
}

export async function transitionMeeting(app: AppLike, token: string, meetingId: string, orgId: string, status: string) {
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/v1/meetings/${meetingId}/org/${orgId}/status`,
    headers: { authorization: `Bearer ${token}` },
    payload: { status },
  });
  if (res.statusCode !== 200) throw new Error(`Transition meeting to ${status} failed: ${res.body}`);
}

export async function addAttendee(app: AppLike, token: string, meetingId: string, orgId: string, memberId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/meetings/${meetingId}/org/${orgId}/attendees`,
    headers: { authorization: `Bearer ${token}` },
    payload: { memberIds: [memberId] },
  });
  if (res.statusCode !== 201) throw new Error(`Add attendee failed: ${res.body}`);
}

export async function setupVoteContext(app: AppLike) {
  const email = uniqueEmail();
  const password = 'test-password-123';
  const user = await createVerifiedUser(email, password);
  const token = await loginUser(app, email, password);
  const org = await createOrg(app, token, `Vote Org ${randomUUID()}`);
  await completeOnboarding(org.id);
  const memberId = await getMembershipId(user.id, org.id);
  const meeting = await createMeeting(app, token, org.id);
  await transitionMeeting(app, token, meeting.id, org.id, 'SCHEDULED');
  await addAttendee(app, token, meeting.id, org.id, memberId);
  await transitionMeeting(app, token, meeting.id, org.id, 'IN_PROGRESS');
  return { token, orgId: org.id, meetingId: meeting.id, memberId, userId: user.id };
}
