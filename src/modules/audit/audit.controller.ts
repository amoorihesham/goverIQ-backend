import type { FastifyReply, FastifyRequest } from 'fastify';

import { auditService } from './audit.service';
import { AuditExportParams, AuditExportQueryString, AuditQueryParams, AuditQueryString } from './types/request';

import type { DatabaseClient } from '@/shared/database/types';
import { success } from '@/shared/errors/envelope';

export function createAuditController(db: DatabaseClient) {
  const service = auditService(db);

  return {
    async queryAuditLog(
      request: FastifyRequest<{ Params: AuditQueryParams; Querystring: AuditQueryString }>,
      reply: FastifyReply,
    ) {
      const { orgId } = request.params;
      const filters = request.query;
      const result = await service.query(orgId, filters);
      return reply.send(success(result));
    },

    async exportAuditLog(
      request: FastifyRequest<{ Params: AuditExportParams; Querystring: AuditExportQueryString }>,
      reply: FastifyReply,
    ) {
      const { orgId } = request.params;
      const filters = request.query;
      const { format } = filters;
      const ext = format === 'pdf' ? 'pdf' : 'csv';
      const contentType = format === 'pdf' ? 'application/pdf' : 'text/csv';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `audit-${orgId}-${timestamp}.${ext}`;

      reply.raw.writeHead(200, {
        'content-type': contentType,
        'content-disposition': `attachment; filename="${filename}"`,
      });

      await service.export(orgId, filters, reply.raw);
    },
  };
}
