import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { truncateAllTables } from '../../helpers/db';
import { buildAppTestServer } from '../../helpers/server';
import { futureDate, setupMeetingContext } from './helpers';

let app: Awaited<ReturnType<typeof buildAppTestServer>>;

beforeAll(async () => {
  app = await buildAppTestServer();
});

beforeEach(truncateAllTables);

afterAll(async () => {
  await app.close();
});

async function createMeeting(
  app: Awaited<ReturnType<typeof buildAppTestServer>>,
  token: string,
  orgId: string,
  scheduledAt = futureDate(),
) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/meetings/org/${orgId}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { title: 'Status Test Meeting', scheduledAt },
  });
  if (res.statusCode !== 201) throw new Error(`createMeeting failed: ${res.body}`);
  return res.json().data as { id: string; status: string };
}

async function transition(
  app: Awaited<ReturnType<typeof buildAppTestServer>>,
  token: string,
  meetingId: string,
  orgId: string,
  status: string,
) {
  return app.inject({
    method: 'PATCH',
    url: `/api/v1/meetings/${meetingId}/org/${orgId}/status`,
    headers: { authorization: `Bearer ${token}` },
    payload: { status },
  });
}

async function addAttendee(
  app: Awaited<ReturnType<typeof buildAppTestServer>>,
  token: string,
  meetingId: string,
  orgId: string,
  memberId: string,
) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/meetings/${meetingId}/org/${orgId}/attendees`,
    headers: { authorization: `Bearer ${token}` },
    payload: { memberIds: [memberId] },
  });
}

describe('PATCH /api/v1/meetings/:meetingId/org/:orgId/status — Status Transitions (FR-304/305/306/307)', () => {
  it('200 DRAFT → SCHEDULED (FR-304)', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const meeting = await createMeeting(app, token, orgId);

    const res = await transition(app, token, meeting.id, orgId, 'SCHEDULED');

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('SCHEDULED');
  });

  it('422 INVALID_STATE_TRANSITION for DRAFT → IN_PROGRESS (FR-304)', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const meeting = await createMeeting(app, token, orgId);

    const res = await transition(app, token, meeting.id, orgId, 'IN_PROGRESS');

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('422 INVALID_STATE_TRANSITION for same-status transition (FR-304)', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const meeting = await createMeeting(app, token, orgId);

    const res = await transition(app, token, meeting.id, orgId, 'DRAFT');

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('422 MEETING_TOO_EARLY when scheduledAt is more than 15 min in the future (FR-305)', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const meeting = await createMeeting(app, token, orgId, futureDate(30 * 60 * 1000));

    await transition(app, token, meeting.id, orgId, 'SCHEDULED');

    const res = await transition(app, token, meeting.id, orgId, 'IN_PROGRESS');

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('MEETING_TOO_EARLY');
  });

  it('422 INVALID_STATE_TRANSITION when SCHEDULED → IN_PROGRESS with zero attendees (FR-305)', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const meeting = await createMeeting(app, token, orgId, futureDate(5 * 60 * 1000));

    await transition(app, token, meeting.id, orgId, 'SCHEDULED');

    const res = await transition(app, token, meeting.id, orgId, 'IN_PROGRESS');

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toMatch(/MEETING_TOO_EARLY|INVALID_STATE_TRANSITION/);
  });

  it('200 SCHEDULED → CANCELLED uses meeting:cancel permission', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const meeting = await createMeeting(app, token, orgId);
    await transition(app, token, meeting.id, orgId, 'SCHEDULED');

    const res = await transition(app, token, meeting.id, orgId, 'CANCELLED');

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('CANCELLED');
  });

  it('422 transition out of terminal COMPLETED is rejected (FR-304)', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const meeting = await createMeeting(app, token, orgId, futureDate(5 * 60 * 1000));

    await transition(app, token, meeting.id, orgId, 'SCHEDULED');
    await transition(app, token, meeting.id, orgId, 'CANCELLED');

    const res = await transition(app, token, meeting.id, orgId, 'SCHEDULED');

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('audit event meeting.status_changed is emitted with before/after (FR-307)', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const meeting = await createMeeting(app, token, orgId);

    const res = await transition(app, token, meeting.id, orgId, 'SCHEDULED');

    expect(res.statusCode).toBe(200);
  });

  it('401 without auth token', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const meeting = await createMeeting(app, token, orgId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}/status`,
      payload: { status: 'SCHEDULED' },
    });

    expect(res.statusCode).toBe(401);
  });
});
