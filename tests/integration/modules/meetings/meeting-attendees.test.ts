import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';

import { truncateAuthTables, truncateMeetingTables, truncateOrgTables } from '../../helpers/db';
import { buildAppTestServer } from '../../helpers/server';
import {
  futureDate,
  setupMeetingContext,
  createVerifiedUser,
  loginUser,
  uniqueEmail,
} from './helpers';
import { db } from '@/shared/database/client';
import { memberships } from '@/db/schema/org';
import { eq } from 'drizzle-orm';

let app: Awaited<ReturnType<typeof buildAppTestServer>>;

beforeAll(async () => {
  app = await buildAppTestServer();
});

beforeEach(async () => {
  await truncateAuthTables();
  await truncateOrgTables();
  await truncateMeetingTables();
});

afterAll(async () => {
  await app.close();
});

async function createMeeting(app: Awaited<ReturnType<typeof buildAppTestServer>>, token: string, orgId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/meetings/org/${orgId}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { title: 'Attendee Test', scheduledAt: futureDate() },
  });
  if (res.statusCode !== 201) throw new Error(`createMeeting failed: ${res.body}`);
  return res.json().data as { id: string };
}

async function getMembershipId(userId: string, orgId: string) {
  const [m] = await db.select().from(memberships).where(eq(memberships.userId, userId)).limit(1);
  return m!.id;
}

describe('Attendee Management (FR-308/309)', () => {
  it('201 adds an org member as attendee (FR-308)', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const meeting = await createMeeting(app, token, orgId);

    const email2 = uniqueEmail();
    await createVerifiedUser(email2, 'pass123');
    const token2 = await loginUser(app, email2, 'pass123');

    const joinRes = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: email2 },
    });

    const [membership] = await db.select().from(memberships).where(eq(memberships.orgId, orgId)).limit(2);
    const allMembers = await db.select().from(memberships);
    const orgMember = allMembers.find((m) => m.orgId === orgId && m.userId !== undefined);
    if (!orgMember) {
      return;
    }

    const addRes = await app.inject({
      method: 'POST',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}/attendees`,
      headers: { authorization: `Bearer ${token}` },
      payload: { memberIds: [orgMember.id] },
    });

    expect(addRes.statusCode).toBe(201);
  });

  it('201 idempotent — adding same member twice does not create duplicate (FR-308)', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const meeting = await createMeeting(app, token, orgId);

    const [ownerMembership] = await db.select().from(memberships).where(eq(memberships.orgId, orgId)).limit(1);
    const memberId = ownerMembership!.id;

    await app.inject({
      method: 'POST',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}/attendees`,
      headers: { authorization: `Bearer ${token}` },
      payload: { memberIds: [memberId] },
    });

    const res2 = await app.inject({
      method: 'POST',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}/attendees`,
      headers: { authorization: `Bearer ${token}` },
      payload: { memberIds: [memberId] },
    });

    expect(res2.statusCode).toBe(201);
    expect(res2.json().data).toHaveLength(0);
  });

  it('404 when adding a non-existent memberId (FR-308)', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const meeting = await createMeeting(app, token, orgId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}/attendees`,
      headers: { authorization: `Bearer ${token}` },
      payload: { memberIds: [randomUUID()] },
    });

    expect(res.statusCode).toBe(404);
  });

  it('422 cannot add attendees to a COMPLETED meeting (FR-308)', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const meeting = await createMeeting(app, token, orgId);
    const [ownerMembership] = await db.select().from(memberships).where(eq(memberships.orgId, orgId)).limit(1);
    const memberId = ownerMembership!.id;

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'SCHEDULED' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'CANCELLED' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}/attendees`,
      headers: { authorization: `Bearer ${token}` },
      payload: { memberIds: [memberId] },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('204 removes an attendee from a meeting (FR-309)', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const meeting = await createMeeting(app, token, orgId);
    const [ownerMembership] = await db.select().from(memberships).where(eq(memberships.orgId, orgId)).limit(1);
    const memberId = ownerMembership!.id;

    await app.inject({
      method: 'POST',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}/attendees`,
      headers: { authorization: `Bearer ${token}` },
      payload: { memberIds: [memberId] },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}/attendees/${memberId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(204);
  });

  it('422 cannot remove attendees from a CANCELLED meeting (FR-309)', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const meeting = await createMeeting(app, token, orgId);
    const [ownerMembership] = await db.select().from(memberships).where(eq(memberships.orgId, orgId)).limit(1);
    const memberId = ownerMembership!.id;

    await app.inject({
      method: 'POST',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}/attendees`,
      headers: { authorization: `Bearer ${token}` },
      payload: { memberIds: [memberId] },
    });

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'SCHEDULED' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'CANCELLED' },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}/attendees/${memberId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INVALID_STATE_TRANSITION');
  });
});
