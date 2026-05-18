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

async function createVote(app: Awaited<ReturnType<typeof buildAppTestServer>>, token: string, meetingId: string, orgId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/votes/meeting/${meetingId}/org/${orgId}`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      question: 'Ballot test vote?',
      options: ['Yes', 'No'],
      affirmativeOption: 'Yes',
      deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
  });
  if (res.statusCode !== 201) throw new Error(`Create vote failed: ${res.body}`);
  return res.json().data as { id: string };
}

describe('POST /api/v1/votes/:voteId/meeting/:meetingId/org/:orgId/ballots — Cast Ballot (FR-405/406/407)', () => {
  it('204 eligible member casts a ballot successfully (FR-405)', async () => {
    const { token, orgId, meetingId } = await setupVoteContext(app);
    const vote = await createVote(app, token, meetingId, orgId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/votes/${vote.id}/meeting/${meetingId}/org/${orgId}/ballots`,
      headers: { authorization: `Bearer ${token}` },
      payload: { choice: 'Yes' },
    });

    expect(res.statusCode).toBe(204);
  });

  it('409 DUPLICATE_BALLOT when same member votes twice (FR-406)', async () => {
    const { token, orgId, meetingId } = await setupVoteContext(app);
    const vote = await createVote(app, token, meetingId, orgId);

    await app.inject({
      method: 'POST',
      url: `/api/v1/votes/${vote.id}/meeting/${meetingId}/org/${orgId}/ballots`,
      headers: { authorization: `Bearer ${token}` },
      payload: { choice: 'Yes' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/votes/${vote.id}/meeting/${meetingId}/org/${orgId}/ballots`,
      headers: { authorization: `Bearer ${token}` },
      payload: { choice: 'No' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('DUPLICATE_BALLOT');
  });

  it('400 VALIDATION_ERROR when choice not in options (FR-405)', async () => {
    const { token, orgId, meetingId } = await setupVoteContext(app);
    const vote = await createVote(app, token, meetingId, orgId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/votes/${vote.id}/meeting/${meetingId}/org/${orgId}/ballots`,
      headers: { authorization: `Bearer ${token}` },
      payload: { choice: 'Maybe' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('422 VOTE_CLOSED when ballot cast on a closed vote (FR-405)', async () => {
    const { token, orgId, meetingId } = await setupVoteContext(app);
    const vote = await createVote(app, token, meetingId, orgId);

    // Close the vote
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/votes/${vote.id}/meeting/${meetingId}/org/${orgId}/close`,
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/votes/${vote.id}/meeting/${meetingId}/org/${orgId}/ballots`,
      headers: { authorization: `Bearer ${token}` },
      payload: { choice: 'Yes' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VOTE_CLOSED');
  });

  it('response payload carries no per-member choice (FR-407)', async () => {
    const { token, orgId, meetingId } = await setupVoteContext(app);
    const vote = await createVote(app, token, meetingId, orgId);

    await app.inject({
      method: 'POST',
      url: `/api/v1/votes/${vote.id}/meeting/${meetingId}/org/${orgId}/ballots`,
      headers: { authorization: `Bearer ${token}` },
      payload: { choice: 'Yes' },
    });

    // Read the vote — no choice or ballot details should appear
    const readRes = await app.inject({
      method: 'GET',
      url: `/api/v1/votes/${vote.id}/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(readRes.statusCode).toBe(200);
    const data = readRes.json().data;
    expect(JSON.stringify(data)).not.toContain('choice');
    expect(JSON.stringify(data)).not.toContain('ballots');
  });

  it('401 without auth token', async () => {
    const { orgId, meetingId } = await setupVoteContext(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/votes/00000000-0000-0000-0000-000000000001/meeting/${meetingId}/org/${orgId}/ballots`,
      payload: { choice: 'Yes' },
    });

    expect(res.statusCode).toBe(401);
  });
});
