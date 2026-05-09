# Phase 2 — Async Work & Queues: Full Technical Implementation Plan

## Context

**Why this change is needed:**  
The current notification flow blocks the request path on SMTP. `sendOtpEmail()` in `auth.service.ts:57-65` fires nodemailer synchronously inside the request lifecycle (fire-and-forget with `.catch()`). A slow or failed SMTP server delays or silently drops OTPs. The invitation email in `member.service.ts:85` is a plain TODO — it doesn't exist at all. Neither path has retry logic or observability.

**What this delivers:**  
- SMTP latency disappears from user-perceived response time  
- Failed deliveries retry with exponential backoff instead of silently vanishing  
- A separate worker process that scales and deploys independently from HTTP  
- Three background cleanup jobs that keep DB tables bounded  

**Scope:** Phase 2 of `docs/SCALE_PLAN.md` — Sections 2.1 through 2.4.

---

## 0. Prerequisites (install + env)

### 0.1 Install packages

```bash
pnpm add bullmq ioredis
```

### 0.2 Add env vars to `src/shared/config/env.ts`

Append to the `envSchema` Zod object (after `SMTP_FROM`):

```ts
REDIS_URL: z.string().url().optional(),
QUEUE_BACKEND: z.enum(['memory', 'redis']).default(
  process.env.NODE_ENV === 'production' ? 'redis' : 'memory'
),
APP_BASE_URL: z.string().url(),
```

### 0.3 Add env keys to `.env.development` and `.env.test`

```
# .env.development
REDIS_URL=redis://localhost:6379
QUEUE_BACKEND=memory
APP_BASE_URL=http://localhost:3000

# .env.test
QUEUE_BACKEND=memory
APP_BASE_URL=http://localhost:3000
```

### 0.4 Add Redis service to `docker-compose.yml`

Append a `redis` service alongside `postgres` and `mailpit`:

```yaml
redis:
  image: redis:7-alpine
  ports:
    - '6379:6379'
  healthcheck:
    test: ['CMD', 'redis-cli', 'ping']
    interval: 5s
    retries: 5
```

---

## 1. Notification dispatcher abstraction — `src/shared/notifications/dispatcher.ts`

**Create new file** `src/shared/notifications/dispatcher.ts`:

```ts
import { logger } from '@/shared/logger';

export type NotificationTemplate = 'email-verification' | 'invitation';

export interface EnqueueOptions {
  reqId?: string;
  jobId?: string;
}

export interface NotificationDispatcher {
  enqueue(
    template: NotificationTemplate,
    to: string,
    data: Record<string, unknown>,
    opts?: EnqueueOptions,
  ): Promise<void>;
}

/** Dev/test: runs the handler inline on the next tick. No persistence. */
export class InProcessDispatcher implements NotificationDispatcher {
  constructor(
    private readonly handler: (
      template: NotificationTemplate,
      to: string,
      data: Record<string, unknown>,
    ) => Promise<void>,
  ) {}

  async enqueue(
    template: NotificationTemplate,
    to: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    setImmediate(() => {
      this.handler(template, to, data).catch((err) =>
        logger.error({ err, template }, 'InProcessDispatcher: handler failed'),
      );
    });
  }
}

/** Prod: enqueues into BullMQ. Imported lazily to avoid requiring Redis in dev. */
export class BullMQDispatcher implements NotificationDispatcher {
  private queue: import('bullmq').Queue;

  constructor(queue: import('bullmq').Queue) {
    this.queue = queue;
  }

  async enqueue(
    template: NotificationTemplate,
    to: string,
    data: Record<string, unknown>,
    opts: EnqueueOptions = {},
  ): Promise<void> {
    await this.queue.add(
      template,
      { template, to, data },
      {
        jobId: opts.jobId,
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86_400 },
      },
    );
  }
}

export function createDispatcher(
  notifHandler: (
    template: NotificationTemplate,
    to: string,
    data: Record<string, unknown>,
  ) => Promise<void>,
): NotificationDispatcher {
  const { env } = require('@/shared/config/env');
  if (env.QUEUE_BACKEND === 'redis' && env.REDIS_URL) {
    const { Queue } = require('bullmq');
    const IORedis = require('ioredis').default ?? require('ioredis');
    const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
    const queue = new Queue('notifications', { connection });
    return new BullMQDispatcher(queue);
  }
  return new InProcessDispatcher(notifHandler);
}
```

---

## 2. Refactor `src/shared/notifications/service.ts`

**Problem:** The SMTP transport is created at module load (line 41: `const transport = createTransport()`). This blocks startup and couples SMTP to the HTTP boot path.

**Changes:**

1. Make transport lazy-initialised (memoized singleton, created on first `send()` call).
2. Export a typed `sendNotification()` worker handler — service code never calls the old `notificationService.send()` directly after this phase.
3. Re-throw errors so BullMQ retry logic triggers.

**Full replacement of `src/shared/notifications/service.ts`:**

```ts
import nodemailer from 'nodemailer';

import { logger } from '@/shared/logger';
import type { NotificationTemplate } from './dispatcher';
import { buildEmailVerificationEmail } from './templates/email-verification';
import { buildInvitationEmail } from './templates/invitation';

let _transport: nodemailer.Transporter | null = null;

function getTransport(): nodemailer.Transporter {
  if (_transport) return _transport;

  const nodeEnv = process.env.NODE_ENV || 'development';

  if (nodeEnv === 'test') {
    _transport = nodemailer.createTransport({ jsonTransport: true });
    return _transport;
  }

  if (nodeEnv === 'development') {
    _transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '1025', 10),
      secure: false,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    });
    return _transport;
  }

  _transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE !== 'false',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
  return _transport;
}

/** Worker-side handler — called by InProcessDispatcher (inline) and BullMQ worker. */
export async function sendNotification(
  template: NotificationTemplate,
  to: string,
  data: Record<string, unknown>,
): Promise<void> {
  let subject: string;
  let text: string;

  if (template === 'email-verification') {
    ({ subject, text } = buildEmailVerificationEmail(
      data as { otp: string; expiresInMinutes: number },
    ));
  } else if (template === 'invitation') {
    ({ subject, text } = buildInvitationEmail(
      data as { inviteUrl: string; orgName: string },
    ));
  } else {
    logger.warn({ template }, 'Unknown notification template');
    return;
  }

  const transport = getTransport();
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || 'noreply@groven.local',
      to,
      subject,
      text,
    });
  } catch (err) {
    logger.error({ err, to: '[REDACTED]', template }, 'Failed to send notification');
    throw err; // re-throw so BullMQ retry logic triggers
  }
}
```

### 2.1 Create invitation email template — `src/shared/notifications/templates/invitation.ts`

```ts
export function buildInvitationEmail(data: { inviteUrl: string; orgName: string }): {
  subject: string;
  text: string;
} {
  return {
    subject: `You've been invited to join ${data.orgName} on GoverIQ`,
    text: `You've been invited to join ${data.orgName}.\n\nAccept your invitation:\n${data.inviteUrl}\n\nThis link expires in 7 days.`,
  };
}
```

---

## 3. Wire dispatcher into Fastify

### 3.1 New file `src/shared/notifications/plugin.ts`

```ts
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

import { createDispatcher, type NotificationDispatcher } from './dispatcher';
import { sendNotification } from './service';

declare module 'fastify' {
  interface FastifyInstance {
    dispatcher: NotificationDispatcher;
  }
}

export const notificationPlugin = fp(async (app: FastifyInstance) => {
  const dispatcher = createDispatcher(sendNotification);
  app.decorate('dispatcher', dispatcher);
});
```

### 3.2 Register in `src/app.ts`

Import and register **before** route plugins:

```ts
import { notificationPlugin } from '@/shared/notifications/plugin';
// inside buildApp():
await app.register(notificationPlugin);
```

---

## 4. Update call sites

### 4.1 `src/modules/auth/auth.service.ts`

**Remove** the import of `notificationService` (line 25) and `buildEmailVerificationEmail` (line 26).

**Add import:**

```ts
import type { NotificationDispatcher } from '@/shared/notifications/dispatcher';
```

**Change function signature** to accept dispatcher:

```ts
export function createAuthService(db: DatabaseClient, dispatcher: NotificationDispatcher) {
```

**Delete** `sendOtpEmail()` helper (lines 57–65) entirely.

**Replace** the `sendOtpEmail(input.email, code)` call in `register()` (line 110):

```ts
await dispatcher.enqueue('email-verification', input.email, {
  otp: code,
  expiresInMinutes: Math.round(env.OTP_TTL_MS / 1000 / 60),
});
```

**Same replacement** in `resendOtp()` (same pattern, ~line 279).

> Both enqueue calls go **after** the DB transaction commits — same position as the old `sendOtpEmail()` call.

**Update `src/modules/auth/auth.routes.ts`** — wherever `createAuthService(db)` is called, pass the dispatcher:

```ts
const authService = createAuthService(db, request.server.dispatcher);
// or at plugin-init time: createAuthService(db, app.dispatcher)
```

### 4.2 `src/modules/org/member.service.ts`

**Add import:**

```ts
import type { NotificationDispatcher } from '@/shared/notifications/dispatcher';
import { env } from '@/shared/config/env';
```

**Add `dispatcher` parameter** to `sendInvitation`:

```ts
static async sendInvitation(
  userId: string,
  orgId: string,
  body: { email: string; roleId: string },
  dispatcher: NotificationDispatcher,
)
```

**Resolve the TODO** at line 85 — replace the comment with:

```ts
await dispatcher.enqueue('invitation', body.email, {
  inviteUrl: `${env.APP_BASE_URL}/invitations/${token}/accept`,
  orgName: org.name,   // fetch org name inside the tx (already queried for guard purposes)
});
```

> Note: fetch `org.name` inside the `withTx` block if not already available. The org record is already loaded in the membership guard query — reuse it.

**Update the member controller** to pass `req.server.dispatcher` when calling `sendInvitation`.

---

## 5. BullMQ queue infrastructure — `src/shared/queue/bullmq.ts`

**Create new file** `src/shared/queue/bullmq.ts`:

```ts
import { Queue, Worker, type Processor } from 'bullmq';
import IORedis from 'ioredis';

import { env } from '@/shared/config/env';

let _connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (_connection) return _connection;
  if (!env.REDIS_URL) throw new Error('REDIS_URL is required when QUEUE_BACKEND=redis');
  _connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _connection;
}

export function createQueue(name: string): Queue {
  return new Queue(name, { connection: getRedisConnection() });
}

export function createWorker<T>(name: string, processor: Processor<T>): Worker<T> {
  return new Worker(name, processor, {
    connection: getRedisConnection(),
    concurrency: 5,
  });
}

export async function closeConnection(): Promise<void> {
  if (_connection) {
    await _connection.quit();
    _connection = null;
  }
}
```

---

## 6. Worker entrypoint — `src/worker.ts`

**Create new file** `src/worker.ts`:

```ts
import { logger } from '@/shared/logger';
import { db, pool } from '@/shared/database/client';
import { sendNotification } from '@/shared/notifications/service';
import { createWorker, getRedisConnection, closeConnection } from '@/shared/queue/bullmq';
import { cleanupOtpsJob } from '@/shared/queue/jobs/cleanup-otps';
import { expireInvitesJob } from '@/shared/queue/jobs/expire-invites';
import { cleanupRefreshJob } from '@/shared/queue/jobs/cleanup-refresh';
import { Queue } from 'bullmq';
import type { NotificationTemplate } from '@/shared/notifications/dispatcher';

async function main() {
  logger.info('Worker starting');

  const notifWorker = createWorker<{ template: NotificationTemplate; to: string; data: Record<string, unknown> }>(
    'notifications',
    async (job) => {
      await sendNotification(job.data.template, job.data.to, job.data.data);
    },
  );

  const systemQueue = new Queue('system', { connection: getRedisConnection() });
  await systemQueue.add('cleanup-otps', {}, { repeat: { every: 10 * 60 * 1000 } });
  await systemQueue.add('expire-invites', {}, { repeat: { every: 60 * 60 * 1000 } });
  await systemQueue.add('cleanup-refresh', {}, { repeat: { pattern: '0 3 * * *' } });

  const systemWorker = createWorker('system', async (job) => {
    if (job.name === 'cleanup-otps')    return cleanupOtpsJob(db);
    if (job.name === 'expire-invites')  return expireInvitesJob(db);
    if (job.name === 'cleanup-refresh') return cleanupRefreshJob(db);
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Worker shutdown signal received');
    try {
      await notifWorker.close();
      await systemWorker.close();
      await systemQueue.close();
      await closeConnection();
      await pool.end();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Worker shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  logger.info('Worker ready');
}

main().catch((err) => {
  logger.error({ err }, 'Worker fatal error');
  process.exit(1);
});
```

### 6.1 Export `pool` from `src/shared/database/client.ts`

Current file exports only `db`. Add `pool` to the exports:

```ts
export { db, pool };
```

(`pool` is the `pg.Pool` instance already created in `client.ts`.)

---

## 7. Background cleanup jobs

### 7.1 `src/shared/queue/jobs/cleanup-otps.ts`

```ts
import { lt } from 'drizzle-orm';
import { emailVerifications } from '@/db/schema/auth';
import { emitAudit } from '@/shared/audit/emitter';
import type { DatabaseClient } from '@/shared/database/types';
import { withTx } from '@/shared/database/transaction';

export async function cleanupOtpsJob(db: DatabaseClient): Promise<void> {
  await withTx(async (tx) => {
    const result = await tx
      .delete(emailVerifications)
      .where(lt(emailVerifications.expiresAt, new Date()))
      .returning({ id: emailVerifications.id });

    await emitAudit(tx, {
      event: 'system.cleanup',
      entityType: 'emailVerification',
      entityId: null,
      actorId: null,
      orgId: null,
      payload: { job: 'cleanup-otps', deletedCount: result.length },
    });
  });
}
```

### 7.2 `src/shared/queue/jobs/expire-invites.ts`

```ts
import { and, eq, lt } from 'drizzle-orm';
import { invitations } from '@/db/schema/org';
import { emitAudit } from '@/shared/audit/emitter';
import type { DatabaseClient } from '@/shared/database/types';
import { withTx } from '@/shared/database/transaction';

export async function expireInvitesJob(db: DatabaseClient): Promise<void> {
  await withTx(async (tx) => {
    const result = await tx
      .update(invitations)
      .set({ status: 'EXPIRED' })
      .where(and(eq(invitations.status, 'PENDING'), lt(invitations.expiresAt, new Date())))
      .returning({ id: invitations.id });

    await emitAudit(tx, {
      event: 'system.cleanup',
      entityType: 'invitation',
      entityId: null,
      actorId: null,
      orgId: null,
      payload: { job: 'expire-invites', expiredCount: result.length },
    });
  });
}
```

### 7.3 `src/shared/queue/jobs/cleanup-refresh.ts`

```ts
import { lt } from 'drizzle-orm';
import { refreshTokens } from '@/db/schema/auth';
import { emitAudit } from '@/shared/audit/emitter';
import type { DatabaseClient } from '@/shared/database/types';
import { withTx } from '@/shared/database/transaction';

export async function cleanupRefreshJob(db: DatabaseClient): Promise<void> {
  await withTx(async (tx) => {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await tx
      .delete(refreshTokens)
      .where(lt(refreshTokens.expiresAt, cutoff))
      .returning({ id: refreshTokens.id });

    await emitAudit(tx, {
      event: 'system.cleanup',
      entityType: 'refreshToken',
      entityId: null,
      actorId: null,
      orgId: null,
      payload: { job: 'cleanup-refresh', deletedCount: result.length },
    });
  });
}
```

---

## 8. Build and scripts

### 8.1 `tsup.config.ts` — add worker entrypoint

```ts
entry: ['src/main.ts', 'src/worker.ts'],
```

### 8.2 `package.json` — add scripts

```json
"worker":     "node dist/worker.js",
"dev:worker": "cross-env NODE_ENV=development tsx watch src/worker.ts"
```

### 8.3 `docker-compose.yml` — add worker service

```yaml
worker:
  build: .
  command: node dist/worker.js
  environment:
    NODE_ENV: production
    DATABASE_URL: postgres://groven:groven@postgres:5432/groven_test
    REDIS_URL: redis://redis:6379
    QUEUE_BACKEND: redis
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy
```

---

## 9. `emitAudit` compatibility check

The cleanup jobs pass `actorId: null` and `entityId: null`. Verify in `src/shared/audit/emitter.ts` that the `AuditEvent` interface marks these fields as `string | null` (not `string`). The DB schema in `src/db/schema/audit.ts` already allows NULL — if the TypeScript interface doesn't match, widen the types.

---

## Critical files — summary

| Action | File |
|--------|------|
| **Create** | `src/shared/notifications/dispatcher.ts` |
| **Create** | `src/shared/notifications/plugin.ts` |
| **Create** | `src/shared/notifications/templates/invitation.ts` |
| **Create** | `src/shared/queue/bullmq.ts` |
| **Create** | `src/shared/queue/jobs/cleanup-otps.ts` |
| **Create** | `src/shared/queue/jobs/expire-invites.ts` |
| **Create** | `src/shared/queue/jobs/cleanup-refresh.ts` |
| **Create** | `src/worker.ts` |
| **Modify** | `src/shared/notifications/service.ts` — lazy transport, re-throw on error, `sendNotification` export |
| **Modify** | `src/shared/config/env.ts` — add `REDIS_URL`, `QUEUE_BACKEND`, `APP_BASE_URL` |
| **Modify** | `src/shared/database/client.ts` — export `pool` |
| **Modify** | `src/modules/auth/auth.service.ts` — accept `dispatcher` param, replace `sendOtpEmail()` |
| **Modify** | `src/modules/org/member.service.ts` — accept `dispatcher` param, resolve TODO at line 85 |
| **Modify** | `src/modules/auth/auth.routes.ts` — pass `dispatcher` to `createAuthService` |
| **Modify** | `src/modules/org/member.controller.ts` — pass `dispatcher` to `sendInvitation` |
| **Modify** | `src/app.ts` — register `notificationPlugin` |
| **Modify** | `tsup.config.ts` — add `src/worker.ts` entry |
| **Modify** | `package.json` — add `worker` / `dev:worker` scripts |
| **Modify** | `docker-compose.yml` — add `redis` and `worker` services |
| **Add env keys** | `.env.development`, `.env.test` — `REDIS_URL`, `QUEUE_BACKEND`, `APP_BASE_URL` |

---

## Verification

Per `SCALE_PLAN.md` Phase 2 verification checklist:

1. **SMTP decoupled from request path**  
   `docker-compose stop mailpit` → `POST /auth/register` completes in ≤50ms, returns 201.

2. **Retry delivers after SMTP recovers**  
   Restart mailpit → within the BullMQ exponential backoff window (~30s first retry), the job succeeds and the email arrives in mailpit UI.

3. **In-process mode works without Redis**  
   `QUEUE_BACKEND=memory` → `POST /auth/register` → OTP email delivered immediately (via `setImmediate`) in dev without Redis running.

4. **Cleanup jobs run and audit correctly**  
   After 10 min of `pnpm dev:worker`: check `audit_logs` for a row with `event = 'system.cleanup'` and `payload.job = 'cleanup-otps'`.

5. **Invitation email sent**  
   `POST /orgs/:id/members/invite` → token link email arrives in mailpit UI.

6. **Worker shuts down cleanly on SIGTERM**  
   `kill -15 <worker-pid>` → logs show "Worker shutdown signal received", pool drains, process exits 0.

7. **Type-check passes**  
   `pnpm type-check` — no errors after all signature changes.

---

## Tasks

- [ ] **0.1** Install `bullmq` and `ioredis` — `pnpm add bullmq ioredis`
- [ ] **0.2** Add `REDIS_URL`, `QUEUE_BACKEND`, `APP_BASE_URL` to `src/shared/config/env.ts`
- [ ] **0.3** Add env keys to `.env.development` and `.env.test`
- [ ] **0.4** Add `redis` service to `docker-compose.yml`
- [ ] **1.0** Create `src/shared/notifications/dispatcher.ts` (`NotificationDispatcher` interface, `InProcessDispatcher`, `BullMQDispatcher`, `createDispatcher` factory)
- [ ] **2.0** Refactor `src/shared/notifications/service.ts` — lazy SMTP transport, export `sendNotification()`, re-throw errors
- [ ] **2.1** Create `src/shared/notifications/templates/invitation.ts` — `buildInvitationEmail()`
- [ ] **3.1** Create `src/shared/notifications/plugin.ts` — Fastify plugin that decorates `app.dispatcher`
- [ ] **3.2** Register `notificationPlugin` in `src/app.ts` (before route plugins)
- [ ] **4.1** Update `src/modules/auth/auth.service.ts` — add `dispatcher` param to `createAuthService`, delete `sendOtpEmail()`, replace with `dispatcher.enqueue()` in `register()` and `resendOtp()`
- [ ] **4.2** Update `src/modules/auth/auth.routes.ts` — pass `request.server.dispatcher` to `createAuthService`
- [ ] **4.3** Update `src/modules/org/member.service.ts` — add `dispatcher` param to `sendInvitation`, resolve TODO at line 85 with `dispatcher.enqueue('invitation', ...)`
- [ ] **4.4** Update `src/modules/org/member.controller.ts` — pass `req.server.dispatcher` to `sendInvitation`
- [ ] **5.0** Create `src/shared/queue/bullmq.ts` — `getRedisConnection`, `createQueue`, `createWorker`, `closeConnection`
- [ ] **6.0** Export `pool` from `src/shared/database/client.ts` alongside `db`
- [ ] **6.1** Create `src/worker.ts` — notifications worker, system cleanup scheduler, SIGTERM/SIGINT graceful shutdown
- [ ] **7.1** Create `src/shared/queue/jobs/cleanup-otps.ts`
- [ ] **7.2** Create `src/shared/queue/jobs/expire-invites.ts`
- [ ] **7.3** Create `src/shared/queue/jobs/cleanup-refresh.ts`
- [ ] **8.1** Update `tsup.config.ts` — add `src/worker.ts` as second entry point
- [ ] **8.2** Update `package.json` — add `worker` and `dev:worker` scripts
- [ ] **8.3** Update `docker-compose.yml` — add `worker` service
- [ ] **9.0** Audit `src/shared/audit/emitter.ts` — widen `actorId` / `entityId` / `orgId` to `string | null` if needed
- [ ] **10.0** Run `pnpm type-check` and fix any errors
