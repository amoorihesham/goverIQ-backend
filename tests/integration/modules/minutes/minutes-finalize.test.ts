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

async function createMinutes(app: Awaited<ReturnType<typeof buildAppTestServer>>, token: string, meetingId: string, orgId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { summary: 'Test minutes summary' },
  });
  if (res.statusCode !== 201) throw new Error(`Create minutes failed: ${res.body}`);
  return res.json().data as { id: string; status: string };
}

async function finalizeMinutes(app: Awaited<ReturnType<typeof buildAppTestServer>>, token: string, meetingId: string, orgId: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}/finalize`,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('POST /api/v1/minutes/meeting/:meetingId/org/:orgId/finalize — Finalize Minutes (FR-416/417)', () => {
  it('200 finalizes DRAFT minutes — status FINALIZED, finalizedAt set (FR-416)', async () => {
    const { token, orgId, meetingId } = await setupMinutesContext(app);
    await createMinutes(app, token, meetingId, orgId);

    const res = await finalizeMinutes(app, token, meetingId, orgId);

    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.status).toBe('FINALIZED');
    expect(data.finalizedAt).toBeDefined();
  });

  it('409 CONFLICT when re-finalizing (FR-416)', async () => {
    const { token, orgId, meetingId } = await setupMinutesContext(app);
    await createMinutes(app, token, meetingId, orgId);
    await finalizeMinutes(app, token, meetingId, orgId);

    const res = await finalizeMinutes(app, token, meetingId, orgId);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('422 MINUTES_FINALIZED when editing a FINALIZED document (FR-417)', async () => {
    const { token, orgId, meetingId } = await setupMinutesContext(app);
    await createMinutes(app, token, meetingId, orgId);
    await finalizeMinutes(app, token, meetingId, orgId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { summary: 'Attempting edit after finalization' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('MINUTES_FINALIZED');
  });

  it('422 MINUTES_FINALIZED when attaching a resolution to a FINALIZED document (FR-417)', async () => {
    const { token, orgId, meetingId, voteId } = await setupMinutesContext(app);
    await createMinutes(app, token, meetingId, orgId);
    await finalizeMinutes(app, token, meetingId, orgId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}/resolutions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { voteId, description: 'Post-finalization resolution attempt' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('MINUTES_FINALIZED');
  });

  it('401 without auth token', async () => {
    const { orgId, meetingId } = await setupMinutesContext(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}/finalize`,
    });

    expect(res.statusCode).toBe(401);
  });
});
