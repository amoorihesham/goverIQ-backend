import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { truncateAllTables } from '../../helpers/db';
import { buildAppTestServer } from '../../helpers/server';
import { setupVoteContext, nearFutureDate } from './helpers';

let app: Awaited<ReturnType<typeof buildAppTestServer>>;

beforeAll(async () => {
  app = await buildAppTestServer();
});

beforeEach(truncateAllTables);

afterAll(async () => {
  await app.close();
});

async function createVote(
  app: Awaited<ReturnType<typeof buildAppTestServer>>,
  token: string,
  meetingId: string,
  orgId: string,
) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/votes/meeting/${meetingId}/org/${orgId}`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      question: 'Close test vote?',
      options: ['Yes', 'No'],
      affirmativeOption: 'Yes',
      deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
  });
  if (res.statusCode !== 201) throw new Error(`Create vote failed: ${res.body}`);
  return res.json().data as { id: string };
}

async function castBallot(
  app: Awaited<ReturnType<typeof buildAppTestServer>>,
  token: string,
  voteId: string,
  meetingId: string,
  orgId: string,
  choice: string,
) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/votes/${voteId}/meeting/${meetingId}/org/${orgId}/ballots`,
    headers: { authorization: `Bearer ${token}` },
    payload: { choice },
  });
}

async function closeVote(
  app: Awaited<ReturnType<typeof buildAppTestServer>>,
  token: string,
  voteId: string,
  meetingId: string,
  orgId: string,
) {
  return app.inject({
    method: 'PATCH',
    url: `/api/v1/votes/${voteId}/meeting/${meetingId}/org/${orgId}/close`,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('PATCH /api/v1/votes/:voteId/meeting/:meetingId/org/:orgId/close — Close Vote (FR-408/409/410)', () => {
  it('200 closes an open vote, records outcome + closedAt (FR-408)', async () => {
    const { token, orgId, meetingId } = await setupVoteContext(app);
    const vote = await createVote(app, token, meetingId, orgId);
    await castBallot(app, token, vote.id, meetingId, orgId, 'Yes');

    const res = await closeVote(app, token, vote.id, meetingId, orgId);

    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.status).toBe('CLOSED');
    expect(data.outcome).toBeDefined();
    expect(data.closedAt).toBeDefined();
  });

  it('PASSED outcome when affirmative option wins with quorum (FR-409)', async () => {
    const { token, orgId, meetingId } = await setupVoteContext(app);
    const vote = await createVote(app, token, meetingId, orgId);
    await castBallot(app, token, vote.id, meetingId, orgId, 'Yes');

    const res = await closeVote(app, token, vote.id, meetingId, orgId);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.outcome).toBe('PASSED');
  });

  it('QUORUM_NOT_MET outcome when not enough votes (FR-409)', async () => {
    const { token, orgId, meetingId } = await setupVoteContext(app);
    const vote = await createVote(app, token, meetingId, orgId);
    // Do NOT cast any ballots — quorum should not be met (org has quorum=0.50, eligible=1, cast=0)

    const res = await closeVote(app, token, vote.id, meetingId, orgId);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.outcome).toBe('QUORUM_NOT_MET');
  });

  it('409 CONFLICT when re-closing an already closed vote (FR-408)', async () => {
    const { token, orgId, meetingId } = await setupVoteContext(app);
    const vote = await createVote(app, token, meetingId, orgId);

    await closeVote(app, token, vote.id, meetingId, orgId);
    const res = await closeVote(app, token, vote.id, meetingId, orgId);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('409 MEETING_HAS_OPEN_VOTES when completing a meeting with an open vote (FR-410)', async () => {
    const { token, orgId, meetingId } = await setupVoteContext(app);
    await createVote(app, token, meetingId, orgId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/meetings/${meetingId}/org/${orgId}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'COMPLETED' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('MEETING_HAS_OPEN_VOTES');
  });

  it('meeting COMPLETED after all votes are closed (FR-410)', async () => {
    const { token, orgId, meetingId } = await setupVoteContext(app);
    const vote = await createVote(app, token, meetingId, orgId);

    await closeVote(app, token, vote.id, meetingId, orgId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/meetings/${meetingId}/org/${orgId}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'COMPLETED' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('COMPLETED');
  });

  it('401 without auth token', async () => {
    const { orgId, meetingId } = await setupVoteContext(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/votes/00000000-0000-0000-0000-000000000001/meeting/${meetingId}/org/${orgId}/close`,
    });

    expect(res.statusCode).toBe(401);
  });
});
