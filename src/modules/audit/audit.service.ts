import { and, desc, eq, gte, lte, SQL } from 'drizzle-orm';

import { AUDIT_EXPORT_BATCH_SIZE } from './constants';
import { AuditQueryString, AuditExportQueryString } from './types/request';
import { renderAuditCsv, AuditCsvRow } from './utils/csv';
import { renderAuditPdf, AuditPdfRow } from './utils/pdf';

import { auditLogs } from '@/db/schema/audit';
import { redactAuditPayload } from '@/shared/audit/redact';
import type { DatabaseClient } from '@/shared/database/types';
import { encodeCursor, decodeCursor, applyKeysetWhere } from '@/shared/pagination/cursor';

type AuditRow = {
  id: string;
  actorId: string | null;
  event: string;
  entityType: string;
  entityId: string | null;
  payload: unknown;
  createdAt: Date;
};

function buildFilterPredicates(
  orgId: string,
  filters: Pick<AuditQueryString, 'actorId' | 'event' | 'entityType' | 'entityId' | 'from' | 'to'>,
): SQL[] {
  const predicates: SQL[] = [eq(auditLogs.orgId, orgId)];
  if (filters.actorId) predicates.push(eq(auditLogs.actorId, filters.actorId));
  if (filters.event) predicates.push(eq(auditLogs.event, filters.event));
  if (filters.entityType) predicates.push(eq(auditLogs.entityType, filters.entityType));
  if (filters.entityId) predicates.push(eq(auditLogs.entityId, filters.entityId));
  if (filters.from) predicates.push(gte(auditLogs.createdAt, filters.from));
  if (filters.to) predicates.push(lte(auditLogs.createdAt, filters.to));
  return predicates;
}

function toResponseRow(row: AuditRow): AuditRow {
  return { ...row, payload: redactAuditPayload(row.payload) };
}

export function auditService(db: DatabaseClient) {
  return {
    async query(orgId: string, filters: AuditQueryString) {
      const { cursor: cursorStr, limit } = filters;
      const cursor = cursorStr ? decodeCursor(cursorStr) : undefined;

      const predicates = buildFilterPredicates(orgId, filters);
      const keysetPred = applyKeysetWhere(auditLogs.createdAt, auditLogs.id, cursor, 'desc');
      if (keysetPred) predicates.push(keysetPred);

      const rows = await db
        .select()
        .from(auditLogs)
        .where(and(...predicates))
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(limit + 1);

      const hasNext = rows.length > limit;
      const entries = (hasNext ? rows.slice(0, limit) : rows).map(toResponseRow);

      const lastRow = hasNext ? rows[limit - 1] : null;
      const nextCursor = lastRow ? encodeCursor({ createdAt: lastRow.createdAt, id: lastRow.id }) : null;

      return { entries, nextCursor };
    },

    async export(orgId: string, filters: AuditExportQueryString, stream: NodeJS.WritableStream): Promise<void> {
      const { format, ...rest } = filters;
      const predicates = buildFilterPredicates(orgId, rest);

      let cursor: ReturnType<typeof decodeCursor> | undefined;
      const batchSize = AUDIT_EXPORT_BATCH_SIZE;

      const allRows: AuditRow[] = [];

      while (true) {
        const batchPredicates = [...predicates];
        const keysetPred = applyKeysetWhere(auditLogs.createdAt, auditLogs.id, cursor, 'desc');
        if (keysetPred) batchPredicates.push(keysetPred);

        const rows = await db
          .select()
          .from(auditLogs)
          .where(and(...batchPredicates))
          .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
          .limit(batchSize);

        if (rows.length === 0) break;

        const redacted = rows.map(toResponseRow);
        allRows.push(...redacted);

        if (rows.length < batchSize) break;

        const last = rows[rows.length - 1]!;
        cursor = { createdAt: last.createdAt, id: last.id };
      }

      if (format === 'pdf') {
        renderAuditPdf(orgId, allRows as AuditPdfRow[], stream);
      } else {
        renderAuditCsv(allRows as AuditCsvRow[], stream);
      }
    },
  };
}
