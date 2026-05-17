
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {  buildTestServer } from '../../helpers/server';
import { signToken } from '@/shared/auth/jwt';
import { CONFIGURATIONS } from '@/modules/auth/public';
import { env } from '@/shared/config/env';



let app: Awaited<ReturnType<typeof buildTestServer>>;

beforeAll(async () => {
  app = await buildTestServer();
});

afterAll(async () => {
  await app.close();
});

describe('identityRequired pre-handler (FR-111)', () => {
  it('missing Authorization header → 401 UNAUTHORIZED', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/protected' });
    
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('non-Bearer prefix → 401 UNAUTHORIZED', async () => {
    const res = await app.inject({
      method: 'GET',
       url: '/api/v1/protected',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('malformed JWT → 401 INVALID_TOKEN', async () => {
    const res = await app.inject({
      method: 'GET',
url: '/api/v1/protected',
      headers: { authorization: 'Bearer not.a.valid.jwt' },
    });
    console.log(res.json());
    
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_TOKEN');
  });

  it('expired JWT → 401 TOKEN_EXPIRED', async () => {
    
    const expiredToken = await signToken(
      { userId: 'test-user-id', email: 'test@example.com' },
      env.JWT_ACCESS_SECRET,
      -1 ,
    );

    const res = await app.inject({
      method: 'GET',
 url: '/api/v1/protected',
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('TOKEN_EXPIRED');
  });

  it('valid JWT → handler sees populated request.user', async () => {
    const accessToken = await signToken({ userId: 'user-uuid-123', email: 'alice@example.com' },env.JWT_ACCESS_SECRET,CONFIGURATIONS.ACCESS_TTL_SECONDS);
    const res = await app.inject({
      method: 'GET',
  url: '/api/v1/protected',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.userId).toBe('user-uuid-123');
    expect(body.user.email).toBe('alice@example.com');
  });
});
