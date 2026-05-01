# Contract: Notification Service (FR-005)

Abstraction over external notification delivery. Domain modules call it with a typed
template name and payload — the underlying transport (SMTP via Nodemailer in MVP) is
opaque to the caller.

## Function Signature

```ts
export type NotificationTemplate =
  | { name: 'email-verification'; payload: { to: string; otp: string; expiresInMinutes: number } }
  | { name: 'invitation';         payload: { to: string; orgName: string; acceptUrl: string; declineUrl: string; expiresAt: string /* ISO 8601 */ } };

export interface NotificationService {
  send(notification: NotificationTemplate): Promise<void>;
}
```

## Behavior

1. **Fire-and-forget.** Delivery failures MUST NOT propagate to the caller (FR-005).
   The returned promise resolves successfully even if the underlying transport fails;
   failures are logged with structured fields and otherwise discarded.
2. **No retry queue in MVP.** A failure is a single failure. Persistent retry / DLQ
   infrastructure is explicitly out of scope for Phase 0 (per implementation plan
   notification-service description).
3. **Templates only.** Callers MUST NOT pass raw HTML / SMTP fields. The two MVP
   templates are the only allowed shapes.
4. **No PII in logs.** Logger redaction (Pino config) ensures `otp`, `acceptUrl`, and
   email addresses (where possible) are not written to the structured log.

## Implementation (Phase 0)

`src/shared/notifications/service.ts` exports a factory `createNotificationService(transport)`
returning the service. `transport` is a thin Nodemailer wrapper:

- **Production**: real SMTP using `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` env vars.
- **Local dev**: SMTP pointing at Mailpit on `localhost:1025` (no auth).
- **Tests**: in-memory transport that captures sent messages for assertion.

## Templates

### `email-verification`

Subject: `Verify your GovernIQ email`
Body:
```
Hello,

Your verification code is: {otp}

This code expires in {expiresInMinutes} minutes.

If you didn't create a GovernIQ account, you can safely ignore this email.

— The GovernIQ team
```

### `invitation`

Subject: `You've been invited to join {orgName} on GovernIQ`
Body:
```
Hello,

You've been invited to join {orgName} on GovernIQ.

Accept: {acceptUrl}
Decline: {declineUrl}

This invitation expires on {expiresAt}.

If you didn't expect this invitation, you can safely decline.

— The GovernIQ team
```

## Phase 0 Deliverables

- `src/shared/notifications/service.ts` — factory + type definitions.
- `src/shared/notifications/transport.ts` — Nodemailer wiring.
- `src/shared/notifications/templates/email-verification.ts` — subject + body builder.
- `src/shared/notifications/templates/invitation.ts` — subject + body builder.
- Unit tests verify the service swallows transport errors and returns successfully.
- Integration test (Phase 0): sending a notification with a deliberately broken SMTP
  config does not throw to the caller (SC-005).
