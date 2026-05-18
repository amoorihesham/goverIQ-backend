import { z } from 'zod';

import { AUDIT_PAGE_SIZE_DEFAULT, AUDIT_PAGE_SIZE_MAX } from '../constants';

// ── Shared filter fields ────────────────────────────────────────────────────
const auditFiltersSchema = z.object({
  actorId: z.string().uuid().optional(),
  event: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

// ── Query ───────────────────────────────────────────────────────────────────
export const auditQueryParamsSchema = z.object({
  orgId: z.string().uuid(),
});

export const auditQueryStringSchema = auditFiltersSchema.extend({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_SIZE_MAX).default(AUDIT_PAGE_SIZE_DEFAULT),
});

const auditEntrySchema = z.object({
  id: z.string().uuid(),
  actorId: z.string().uuid().nullable(),
  event: z.string(),
  entityType: z.string(),
  entityId: z.string().uuid().nullable(),
  payload: z.unknown(),
  createdAt: z.date(),
});

export const auditQueryResponseSchema = z.object({
  entries: z.array(auditEntrySchema),
  nextCursor: z.string().nullable(),
});

export const auditQuerySchema = {
  summary: 'Query the organisation audit log',
  tags: ['Audit'],
  params: auditQueryParamsSchema,
  querystring: auditQueryStringSchema,
  response: {
    200: z.object({ success: z.literal(true), data: auditQueryResponseSchema }),
    401: z.object({
      success: z.literal(false),
      error: z.object({ code: z.string(), message: z.string(), statusCode: z.number() }),
    }),
    403: z.object({
      success: z.literal(false),
      error: z.object({ code: z.string(), message: z.string(), statusCode: z.number() }),
    }),
  },
};

// ── Export ──────────────────────────────────────────────────────────────────
export const auditExportParamsSchema = z.object({
  orgId: z.string().uuid(),
});

export const auditExportQueryStringSchema = auditFiltersSchema.extend({
  format: z.enum(['csv', 'pdf']).default('csv'),
});

export const auditExportSchema = {
  summary: 'Export the organisation audit log',
  tags: ['Audit'],
  params: auditExportParamsSchema,
  querystring: auditExportQueryStringSchema,
  response: {
    200: z.instanceof(Buffer),
    400: z.object({
      success: z.literal(false),
      error: z.object({ code: z.string(), message: z.string(), statusCode: z.number() }),
    }),
    401: z.object({
      success: z.literal(false),
      error: z.object({ code: z.string(), message: z.string(), statusCode: z.number() }),
    }),
    403: z.object({
      success: z.literal(false),
      error: z.object({ code: z.string(), message: z.string(), statusCode: z.number() }),
    }),
  },
};
