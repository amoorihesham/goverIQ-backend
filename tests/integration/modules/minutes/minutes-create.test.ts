import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  truncateAuthTables,
  truncateMeetingTables,
  truncateMinutesTables,
  truncateOrgTables,
  truncateVoteTables,
} from '../../helpers/db';
import { buildAppTestServer } from '../../helpers/server';
import { setupMinutesContext } from './helpers';

let app: Awaited<ReturnType<typeof buildAppTestServer>>;

beforeAll(async () => {
  app = await buildAppTestServer();
});

beforeEach(async () => {
  await truncateMinutesTables();
  await truncateVoteTables();
  await truncateMeetingTables();
  await truncateOrgTables();
  await truncateAuthTables();
});

afterAll(async () => {
  await app.close();
});

describe('POST /api/v1/minutes/meeting/:meetingId/org/:orgId — Create Minutes (FR-412/413/414/415)', () => {
  it('201 creates minutes in DRAFT status for a COMPLETED meeting (FR-412)', async () => {
    const { token, orgId, meetingId } = await setupMinutesContext(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { summary: 'Initial meeting summary', attendanceNotes: '5 present' },
    });

    expect(res.statusCode).toBe(201);
    const { data } = res.json();
    expect(data.status).toBe('DRAFT');
    expect(data.summary).toBe('Initial meeting summary');
    expect(data.meetingId).toBe(meetingId);
  });

  it('409 CONFLICT when creating minutes for a meeting that already has them (FR-412)', async () => {
    const { token, orgId, meetingId } = await setupMinutesContext(app);

    await app.inject({
      method: 'POST',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('422 INVALID_STATE_TRANSITION when creating minutes for a non-COMPLETED meeting (FR-413)', async () => {
    const { token, orgId } = await setupMinutesContext(app);

    // Create a fresh IN_PROGRESS or DRAFT meeting to test
    const mRes = await app.inject({
      method: 'POST',
      url: `/api/v1/meetings/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Non-completed Meeting', scheduledAt: new Date(Date.now() + 60_000).toISOString() },
    });
    const draftMeetingId = mRes.json().data.id as string;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/minutes/meeting/${draftMeetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('200 edit summary/attendanceNotes of DRAFT minutes (FR-414)', async () => {
    const { token, orgId, meetingId } = await setupMinutesContext(app);

    await app.inject({
      method: 'POST',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { summary: 'Original summary' },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { summary: 'Updated summary' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.summary).toBe('Updated summary');
  });

  it('201 attach a resolution referencing a CLOSED vote of the same meeting (FR-415)', async () => {
    const { token, orgId, meetingId, voteId } = await setupMinutesContext(app);

    await app.inject({
      method: 'POST',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}/resolutions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { voteId, description: 'Budget approved per vote result' },
    });

    expect(res.statusCode).toBe(201);
  });

  it('400 attach resolution referencing a non-closed or foreign vote is rejected (FR-415)', async () => {
    const { token, orgId, meetingId } = await setupMinutesContext(app);

    await app.inject({
      method: 'POST',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    const fakeVoteId = '00000000-0000-0000-0000-000000000001';
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}/resolutions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { voteId: fakeVoteId, description: 'Invalid resolution' },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('401 without auth token', async () => {
    const { orgId, meetingId } = await setupMinutesContext(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}`,
      payload: {},
    });

    expect(res.statusCode).toBe(401);
  });
});
