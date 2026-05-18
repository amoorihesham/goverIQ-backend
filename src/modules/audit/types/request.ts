import { z } from 'zod';

import {
  auditQueryParamsSchema,
  auditQueryStringSchema,
  auditExportParamsSchema,
  auditExportQueryStringSchema,
} from '../schemas/zod';

export type AuditQueryParams = z.infer<typeof auditQueryParamsSchema>;
export type AuditQueryString = z.infer<typeof auditQueryStringSchema>;
export type AuditExportParams = z.infer<typeof auditExportParamsSchema>;
export type AuditExportQueryString = z.infer<typeof auditExportQueryStringSchema>;
