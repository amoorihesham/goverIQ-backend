import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { truncateAllTables } from '../../helpers/db';
import { buildAppTestServer } from '../../helpers/server';
import { setupMinutesContext } from './helpers';

let app: Awaited<ReturnType<typeof buildAppTestServer>>;

beforeAll(async () => {
  app = await buildAppTestServer();
});

beforeEach(truncateAllTables);

afterAll(async () => {
  await app.close();
});

async function createAndFinalizeMinutes(
  app: Awaited<ReturnType<typeof buildAppTestServer>>,
  token: string,
  meetingId: string,
  orgId: string,
) {
  await app.inject({
    method: 'POST',
    url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { summary: 'Corrections test minutes' },
  });
  await app.inject({
    method: 'POST',
    url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}/finalize`,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('POST /api/v1/minutes/meeting/:meetingId/org/:orgId/corrections — Corrections (FR-418)', () => {
  it('201 appends a correction to FINALIZED minutes with a timestamp (FR-418)', async () => {
    const { token, orgId, meetingId } = await setupMinutesContext(app);
    await createAndFinalizeMinutes(app, token, meetingId, orgId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}/corrections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { content: 'Corrected: member count was 6 not 5' },
    });

    expect(res.statusCode).toBe(201);
    const { data } = res.json();
    expect(data.content).toBe('Corrected: member count was 6 not 5');
    expect(data.createdAt).toBeDefined();
  });

  it('multiple corrections returned in chronological order (FR-418)', async () => {
    const { token, orgId, meetingId } = await setupMinutesContext(app);
    await createAndFinalizeMinutes(app, token, meetingId, orgId);

    await app.inject({
      method: 'POST',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}/corrections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { content: 'First correction' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}/corrections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { content: 'Second correction' },
    });

    const readRes = await app.inject({
      method: 'GET',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(readRes.statusCode).toBe(200);
    const { corrections } = readRes.json().data;
    expect(corrections).toHaveLength(2);
    expect(corrections[0].content).toBe('First correction');
    expect(corrections[1].content).toBe('Second correction');
  });

  it('422 INVALID_STATE_TRANSITION when appending to a DRAFT document (FR-418)', async () => {
    const { token, orgId, meetingId } = await setupMinutesContext(app);

    await app.inject({
      method: 'POST',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { summary: 'Draft minutes' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}/corrections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { content: 'Cannot correct a draft' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('finalized body is unchanged after correction (FR-418)', async () => {
    const { token, orgId, meetingId } = await setupMinutesContext(app);
    await createAndFinalizeMinutes(app, token, meetingId, orgId);

    await app.inject({
      method: 'POST',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}/corrections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { content: 'Correction to finalized minutes' },
    });

    const readRes = await app.inject({
      method: 'GET',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(readRes.statusCode).toBe(200);
    const { data } = readRes.json();
    expect(data.summary).toBe('Corrections test minutes');
    expect(data.status).toBe('FINALIZED');
  });

  it('401 without auth token', async () => {
    const { orgId, meetingId } = await setupMinutesContext(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/minutes/meeting/${meetingId}/org/${orgId}/corrections`,
      payload: { content: 'No token' },
    });

    expect(res.statusCode).toBe(401);
  });
});
