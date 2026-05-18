export const AUDIT_REDACTION_DENYLIST = Object.freeze([
  'passwordHash',
  'password',
  'otpHash',
  'tokenHash',
  'refreshTokenHash',
  'refreshTokenCleartext',
  'accessToken',
  'inviteTokenHash',
] as const);

export function redactAuditPayload(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload.map(redactAuditPayload);
  }
  if (payload !== null && typeof payload === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if ((AUDIT_REDACTION_DENYLIST as readonly string[]).includes(key)) continue;
      result[key] = redactAuditPayload(value);
    }
    return result;
  }
  return payload;
}
