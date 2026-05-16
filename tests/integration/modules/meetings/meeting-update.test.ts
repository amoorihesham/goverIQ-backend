import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { truncateAuthTables, truncateMeetingTables, truncateOrgTables } from '../../helpers/db';
import { buildAppTestServer } from '../../helpers/server';
import { futureDate, setupMeetingContext } from './helpers';

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
    payload: {
      title: 'Original Title',
      scheduledAt: futureDate(),
      agendaItems: [
        { title: 'Old Item 1', orderIndex: 0 },
        { title: 'Old Item 2', orderIndex: 1 },
      ],
    },
  });
  if (res.statusCode !== 201) throw new Error(`createMeeting failed: ${res.body}`);
  return res.json().data as { id: string };
}

describe('PATCH /api/v1/meetings/:meetingId/org/:orgId — Update Meeting (FR-310/317)', () => {
  it('200 updates meeting title in DRAFT state (FR-310)', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const meeting = await createMeeting(app, token, orgId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Updated Title' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.title).toBe('Updated Title');
  });

  it('200 agenda items are replaced wholesale when supplied (FR-310)', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const meeting = await createMeeting(app, token, orgId);

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        agendaItems: [{ title: 'New Single Item', orderIndex: 0 }],
      },
    });

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const { data } = detail.json();
    expect(data.agendaItems).toHaveLength(1);
    expect(data.agendaItems[0].title).toBe('New Single Item');
  });

  it('200 updates meeting in SCHEDULED state (FR-310)', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const meeting = await createMeeting(app, token, orgId);

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'SCHEDULED' },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Scheduled Update' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.title).toBe('Scheduled Update');
  });

  it('422 INVALID_STATE_TRANSITION when editing a CANCELLED meeting (FR-310)', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const meeting = await createMeeting(app, token, orgId);

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
      method: 'PATCH',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Frozen Edit' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('400 when scheduledAt is in the past (FR-317)', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const meeting = await createMeeting(app, token, orgId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { scheduledAt: new Date(Date.now() - 60_000).toISOString() },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('401 without auth token', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const meeting = await createMeeting(app, token, orgId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}`,
      payload: { title: 'Unauthorized Edit' },
    });

    expect(res.statusCode).toBe(401);
  });
});
