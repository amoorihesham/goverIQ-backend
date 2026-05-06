import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildAuthTestServer } from '../../helpers/server';

import { signAccessToken } from '@/shared/auth/jwt';


let app: FastifyInstance;

beforeAll(async () => {
  app = await buildAuthTestServer();
});

afterAll(async () => {
  await app.close();
});

describe('identityRequired pre-handler (FR-111)', () => {
  it('missing Authorization header → 401 UNAUTHORIZED', async () => {
    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('non-Bearer prefix → 401 UNAUTHORIZED', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('malformed JWT → 401 INVALID_TOKEN', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer not.a.valid.jwt' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_TOKEN');
  });

  it('expired JWT → 401 TOKEN_EXPIRED', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const expiredToken = jwt.sign(
      { sub: 'test-user-id', email: 'test@example.com' },
      process.env.JWT_SECRET!,
      { expiresIn: -1 },
    );

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('TOKEN_EXPIRED');
  });

  it('valid JWT → handler sees populated request.user', async () => {
    const token = await signAccessToken({ sub: 'user-uuid-123', email: 'alice@example.com' });
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.userId).toBe('user-uuid-123');
    expect(body.user.email).toBe('alice@example.com');
  });
});
