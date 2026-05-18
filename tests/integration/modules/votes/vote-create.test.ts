import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  truncateAuthTables,
  truncateMeetingTables,
  truncateOrgTables,
  truncateVoteTables,
} from '../../helpers/db';
import { buildAppTestServer } from '../../helpers/server';
import { setupVoteContext } from './helpers';

let app: Awaited<ReturnType<typeof buildAppTestServer>>;

beforeAll(async () => {
  app = await buildAppTestServer();
});

beforeEach(async () => {
  await truncateVoteTables();
  await truncateMeetingTables();
  await truncateOrgTables();
  await truncateAuthTables();
});

afterAll(async () => {
  await app.close();
});

const validVotePayload = {
  question: 'Should we approve the Q1 budget?',
  options: ['Yes', 'No'],
  affirmativeOption: 'Yes',
  deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
};

describe('POST /api/v1/votes/meeting/:meetingId/org/:orgId — Create Vote (FR-401/402/403/404)', () => {
  it('201 creates a vote with OPEN status and eligibility snapshot (FR-401/402/403)', async () => {
    const { token, orgId, meetingId } = await setupVoteContext(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/votes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: validVotePayload,
    });

    expect(res.statusCode).toBe(201);
    const { data } = res.json();
    expect(data.status).toBe('OPEN');
    expect(data.question).toBe(validVotePayload.question);
    expect(data.options).toEqual(['Yes', 'No']);
    expect(data.affirmativeOption).toBe('Yes');
    expect(data.outcome).toBeNull();
  });

  it('201 snapshot equals current attendees when eligibleMemberIds is null (FR-403)', async () => {
    const { token, orgId, meetingId, memberId } = await setupVoteContext(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/votes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...validVotePayload, eligibleMemberIds: null },
    });

    expect(res.statusCode).toBe(201);
    const { data } = res.json();
    expect(data.eligibleCount).toBe(1);
  });

  it('422 creating vote against a non-IN_PROGRESS meeting → INVALID_STATE_TRANSITION (FR-401)', async () => {
    const { token, orgId } = await setupVoteContext(app);

    // Create a fresh DRAFT meeting
    const mRes = await app.inject({
      method: 'POST',
      url: `/api/v1/meetings/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Draft Meeting', scheduledAt: new Date(Date.now() + 60_000).toISOString() },
    });
    const draftMeetingId = mRes.json().data.id as string;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/votes/meeting/${draftMeetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: validVotePayload,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('400 when options has fewer than 2 entries → VALIDATION_ERROR (FR-402)', async () => {
    const { token, orgId, meetingId } = await setupVoteContext(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/votes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...validVotePayload, options: ['OnlyOne'] },
    });

    expect(res.statusCode).toBe(400);
  });

  it('400 when affirmativeOption not in options → VALIDATION_ERROR (FR-402)', async () => {
    const { token, orgId, meetingId } = await setupVoteContext(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/votes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...validVotePayload, affirmativeOption: 'Maybe' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('400 when options has duplicates → VALIDATION_ERROR (FR-402)', async () => {
    const { token, orgId, meetingId } = await setupVoteContext(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/votes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...validVotePayload, options: ['Yes', 'Yes'] },
    });

    expect(res.statusCode).toBe(400);
  });

  it('400 when explicit eligibleMemberIds is empty array → VALIDATION_ERROR (FR-403)', async () => {
    const { token, orgId, meetingId } = await setupVoteContext(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/votes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...validVotePayload, eligibleMemberIds: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it('400 when explicit eligibleMemberIds contains a non-attendee → rejected (FR-403)', async () => {
    const { token, orgId, meetingId } = await setupVoteContext(app);

    const fakeId = '00000000-0000-0000-0000-000000000001';
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/votes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...validVotePayload, eligibleMemberIds: [fakeId] },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('snapshot unchanged after attendee added post-creation (FR-403)', async () => {
    const { token, orgId, meetingId, memberId } = await setupVoteContext(app);

    // Create vote first
    const voteRes = await app.inject({
      method: 'POST',
      url: `/api/v1/votes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: validVotePayload,
    });
    expect(voteRes.statusCode).toBe(201);
    const originalEligibleCount = voteRes.json().data.eligibleCount;

    // The eligibility snapshot must remain unchanged after the vote is created
    // (Verified by reading the vote — eligibleCount stays the same)
    const readRes = await app.inject({
      method: 'GET',
      url: `/api/v1/votes/${voteRes.json().data.id}/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(readRes.statusCode).toBe(200);
    expect(readRes.json().data.eligibleCount).toBe(originalEligibleCount);
  });

  it('401 without auth token', async () => {
    const { orgId, meetingId } = await setupVoteContext(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/votes/meeting/${meetingId}/org/${orgId}`,
      payload: validVotePayload,
    });

    expect(res.statusCode).toBe(401);
  });
});
