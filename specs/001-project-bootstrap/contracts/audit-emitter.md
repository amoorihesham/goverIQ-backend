# Contract: Audit Emitter (FR-004)

Internal contract for the shared audit-emitting function used by every domain module.

## Function Signature

```ts
import type { PgTransaction } from 'drizzle-orm/pg-core';

export interface AuditEvent {
  orgId: string | null; // nullable per Q1 clarification (auth events have no org)
  actorId: string | null; // nullable for system-originated events
  event: string; // dot-namespaced, e.g. "org.created", "user.registered"
  entityType: string; // e.g. "organization", "user", "vote"
  entityId: string | null; // nullable for events without an entity (logout)
  payload:
    | { before: Record<string, unknown>; after: Record<string, unknown> }
    | { data: Record<string, unknown> };
}

export async function emitAudit(tx: PgTransaction<any, any, any>, event: AuditEvent): Promise<void>;
```

## Rules

1. **`tx` MUST be a transaction handle.** Calling `emitAudit` with the global database
   client is a programming error and MUST be detected at runtime via a brand check on
   the transaction object. The function MUST throw before writing if a non-transaction
   handle is passed.
2. **The audit row is written inside `tx`.** If `tx` rolls back, the audit entry rolls
   back with it (Constitution alignment + Constitution Principle on transactional audit
   logging).
3. **No retries, no fallbacks.** If the audit insert fails, the parent transaction
   fails and the entire business operation rolls back.
4. **Payload sizes are bounded.** Reject (or truncate with a warning log) payloads
   larger than 64 KiB to prevent log-bloat attacks.
5. **The function does NOT log.** Logging is the caller's responsibility; emitter only
   writes to the database.

## Type-Safe Transaction Handle

To enforce rule 1 at compile time we expose a branded type:

```ts
// src/shared/database/transaction.ts
declare const __tx_brand: unique symbol;
export type Tx = PgTransaction<any, any, any> & { readonly [__tx_brand]: true };

export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction((rawTx) => fn(rawTx as Tx));
}
```

`emitAudit` accepts only `Tx`. Domain code obtains a `Tx` through `withTx(...)`.

## Usage Example (Phase 1 preview)

```ts
import { emitAudit } from '@/shared/audit/emitter';
import { withTx } from '@/shared/database/transaction';

await withTx(async (tx) => {
  const [user] = await tx.insert(users).values({ email, passwordHash }).returning();
  await emitAudit(tx, {
    orgId: null, // pre-org event
    actorId: user.id,
    event: 'user.registered',
    entityType: 'user',
    entityId: user.id,
    payload: { data: { email: user.email } },
  });
});
```

If any of the SQL inside `withTx` fails — including the audit insert — the transaction
rolls back atomically and no rows are written.

## Phase 0 Deliverables

- `src/shared/audit/emitter.ts` exports `emitAudit`.
- `src/shared/database/transaction.ts` exports `Tx` type and `withTx` helper.
- Unit tests verify rejection when a non-transaction handle is passed.
- Integration test verifies that a forced rollback discards the audit row (SC-003).
