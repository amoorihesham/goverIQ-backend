import { randomUUID } from 'crypto';

import { eq } from 'drizzle-orm';

import { users } from '@/db/schema/auth';
import { organizations, memberships, roles } from '@/db/schema/org';
import { hashPassword } from '@/modules/auth/public';
import { emitAudit } from '@/shared/audit/emitter';
import { db } from '@/shared/database/client';
import { withTx } from '@/shared/database/transaction';

export function uniqueEmail() {
  return `audit-test-${randomUUID()}@test.example`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AppLike = { inject(opts: any): Promise<any> };

export async function createVerifiedUser(email: string, password = 'Test1234!') {
  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(users).values({ email, passwordHash, isVerified: true }).returning();
  return user!;
}

export async function loginUser(app: AppLike, email: string, password = 'Test1234!') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  if (res.statusCode !== 200) throw new Error(`Login failed: ${res.body}`);
  return res.json().data.accessToken as string;
}

export async function createOrg(app: AppLike, token: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/orgs',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: `Audit Org ${randomUUID()}` },
  });
  if (res.statusCode !== 201) throw new Error(`Create org failed: ${res.body}`);
  const body = res.json();
  return (body.data?.data ?? body.data) as { id: string };
}

export async function completeOnboarding(orgId: string) {
  await db.update(organizations).set({ onboardingStep: 'COMPLETE' }).where(eq(organizations.id, orgId));
}

export async function grantPermission(orgId: string, userId: string, permission: string) {
  const [role] = await db
    .insert(roles)
    .values({ orgId, name: `role-${randomUUID()}`, permissions: [permission], isOwner: false })
    .returning();
  await db.update(memberships).set({ roleId: role!.id }).where(eq(memberships.userId, userId));
}

export async function setupAuditContext(app: AppLike) {
  const email = uniqueEmail();
  const user = await createVerifiedUser(email);
  const token = await loginUser(app, email);
  const org = await createOrg(app, token);
  await completeOnboarding(org.id);

  const membership = await db.query.memberships.findFirst({
    where: (m, { and, eq }) => and(eq(m.userId, user.id), eq(m.orgId, org.id)),
  });

  return { user, token, orgId: org.id, membershipId: membership?.id };
}

export async function seedAuditEvents(orgId: string, actorId: string, count = 5) {
  const events: Array<{ id: string; event: string; createdAt: Date }> = [];
  for (let i = 0; i < count; i++) {
    await withTx(async (tx) => {
      await emitAudit(tx, {
        orgId,
        actorId,
        event: 'meeting.created',
        entityType: 'meeting',
        entityId: randomUUID(),
        payload: { data: { title: `Meeting ${i}` } },
      });
    });
    const latest = await db.query.auditLogs.findFirst({
      where: (a, { eq }) => eq(a.orgId, orgId),
      orderBy: (a, { desc }) => desc(a.createdAt),
    });
    if (latest) events.push({ id: latest.id, event: latest.event, createdAt: latest.createdAt });
  }
  return events;
}
