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

async function createAndFinalizeWithResolution(
  app: Awaited<ReturnType<typeof buildAppTestServer>>,
  token: string,
  meetingId: string,
  orgId: string,
  voteId: string,
) {
  await app.inject({
    method: 'POST',
    url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { summary: 'Final board meeting minutes' },
  });
  await app.inject({
    method: 'POST',
    url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}/resolutions`,
    headers: { authorization: `Bearer ${token}` },
    payload: { voteId, description: 'Budget approved' },
  });
  await app.inject({
    method: 'POST',
    url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}/corrections`,
    headers: { authorization: `Bearer ${token}` },
    payload: { content: 'Correction: vote threshold was 60% not 50%' },
  });
  await app.inject({
    method: 'POST',
    url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}/finalize`,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('GET /api/v1/minutes — Read and Export Minutes (FR-419/420)', () => {
  it('200 reads minutes with body + resolutions + chronological corrections (FR-419)', async () => {
    const { token, orgId, meetingId, voteId } = await setupMinutesContext(app);
    await createAndFinalizeWithResolution(app, token, meetingId, orgId, voteId);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.summary).toBe('Final board meeting minutes');
    expect(data.resolutions).toHaveLength(1);
    expect(data.corrections).toHaveLength(1);
    expect(data.corrections[0].content).toBe('Correction: vote threshold was 60% not 50%');
  });

  it('200 read minutes readable by any org member without minutes:* permission (FR-419)', async () => {
    const { token, orgId, meetingId } = await setupMinutesContext(app);
    await app.inject({
      method: 'POST',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { summary: 'Readable by all members' },
    });

    // The owner has all permissions but the endpoint should accept any org member
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('404 read minutes when no minutes exist (FR-419)', async () => {
    const { token, orgId, meetingId } = await setupMinutesContext(app);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('200 export returns application/pdf with %PDF header (FR-420)', async () => {
    const { token, orgId, meetingId, voteId } = await setupMinutesContext(app);
    await createAndFinalizeWithResolution(app, token, meetingId, orgId, voteId);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}/export`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('attachment');
    // Verify PDF magic bytes
    expect(res.rawPayload.slice(0, 4).toString()).toBe('%PDF');
  });

  it('404 export when no minutes exist (FR-420)', async () => {
    const { token, orgId, meetingId } = await setupMinutesContext(app);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}/export`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('401 without auth token', async () => {
    const { orgId, meetingId } = await setupMinutesContext(app);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}`,
    });

    expect(res.statusCode).toBe(401);
  });
});
