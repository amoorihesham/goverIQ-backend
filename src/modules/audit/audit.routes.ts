import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';

import { createAuditController } from './audit.controller';
import { auditQuerySchema, auditExportSchema } from './schemas/zod';

import { identityRequired } from '@/shared/auth/identity';
import { db } from '@/shared/database/client';
import { attachOrgId } from '@/shared/http/pre-handlers/attach-org-id';
import { requirePermission } from '@/shared/permissions/guard';

export async function auditRoutes(fastify: FastifyInstance) {
  const controller = createAuditController(db);

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/org/:orgId',
    {
      schema: auditQuerySchema,
      preHandler: [identityRequired, attachOrgId, requirePermission('audit:view')],
    },
    controller.queryAuditLog,
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/org/:orgId/export',
    {
      schema: auditExportSchema,
      preHandler: [identityRequired, attachOrgId, requirePermission('audit:export')],
    },
    controller.exportAuditLog,
  );
}
