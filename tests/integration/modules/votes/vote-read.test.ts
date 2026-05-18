import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { truncateAllTables } from '../../helpers/db';
import { buildAppTestServer } from '../../helpers/server';
import { setupVoteContext } from './helpers';

let app: Awaited<ReturnType<typeof buildAppTestServer>>;

beforeAll(async () => {
  app = await buildAppTestServer();
});

beforeEach(truncateAllTables);

afterAll(async () => {
  await app.close();
});

const votePayload = {
  question: 'Read test vote?',
  options: ['Yes', 'No'],
  affirmativeOption: 'Yes',
  deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
};

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
    payload: votePayload,
  });
  if (res.statusCode !== 201) throw new Error(`Create vote failed: ${res.body}`);
  return res.json().data as { id: string };
}

describe('GET /api/v1/votes — List and Read Votes (FR-407/411)', () => {
  it('200 lists votes for a meeting with cursor pagination (FR-411)', async () => {
    const { token, orgId, meetingId } = await setupVoteContext(app);
    await createVote(app, token, meetingId, orgId);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/votes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].question).toBe('Read test vote?');
  });

  it('200 reads a single vote with aggregate result summary only (FR-407/411)', async () => {
    const { token, orgId, meetingId } = await setupVoteContext(app);
    const vote = await createVote(app, token, meetingId, orgId);

    await app.inject({
      method: 'POST',
      url: `/api/v1/votes/${vote.id}/meeting/${meetingId}/org/${orgId}/ballots`,
      headers: { authorization: `Bearer ${token}` },
      payload: { choice: 'Yes' },
    });

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/votes/${vote.id}/meeting/${meetingId}/org/${orgId}/close`,
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/votes/${vote.id}/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.question).toBe('Read test vote?');
    expect(data.status).toBe('CLOSED');
    expect(data.outcome).toBe('PASSED');
    // No per-member choice data
    expect(JSON.stringify(data)).not.toContain('"choice"');
  });

  it('no response exposes per-member ballot choice (FR-407)', async () => {
    const { token, orgId, meetingId } = await setupVoteContext(app);
    const vote = await createVote(app, token, meetingId, orgId);

    await app.inject({
      method: 'POST',
      url: `/api/v1/votes/${vote.id}/meeting/${meetingId}/org/${orgId}/ballots`,
      headers: { authorization: `Bearer ${token}` },
      payload: { choice: 'Yes' },
    });

    // List response
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/votes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(JSON.stringify(listRes.json())).not.toContain('"choice"');

    // Detail response
    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/votes/${vote.id}/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(JSON.stringify(detailRes.json())).not.toContain('"choice"');
  });

  it('200 list with status filter (FR-411)', async () => {
    const { token, orgId, meetingId } = await setupVoteContext(app);
    const vote = await createVote(app, token, meetingId, orgId);

    // Close the vote
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/votes/${vote.id}/meeting/${meetingId}/org/${orgId}/close`,
      headers: { authorization: `Bearer ${token}` },
    });

    const openRes = await app.inject({
      method: 'GET',
      url: `/api/v1/votes/meeting/${meetingId}/org/${orgId}?status=OPEN`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(openRes.json().data.items).toHaveLength(0);

    const closedRes = await app.inject({
      method: 'GET',
      url: `/api/v1/votes/meeting/${meetingId}/org/${orgId}?status=CLOSED`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(closedRes.json().data.items).toHaveLength(1);
  });

  it('401 without auth token', async () => {
    const { orgId, meetingId } = await setupVoteContext(app);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/votes/meeting/${meetingId}/org/${orgId}`,
    });

    expect(res.statusCode).toBe(401);
  });
});
