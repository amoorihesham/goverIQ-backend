import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { OrgController } from './org.controller';
import { identityRequired } from '@/shared/auth/identity';
import { requireOnboardingStep } from './onboarding.prehandler';

const CreateOrgRequestSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  logoUrl: z.string().url().optional(),
});

type CreateOrgRequest = z.infer<typeof CreateOrgRequestSchema>;

export async function orgRoutes(fastify: FastifyInstance) {
  // POST /api/v1/orgs - Create organization
  fastify.post<{ Body: CreateOrgRequest }>(
    '/orgs',
    {
      preHandler: identityRequired,
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string', maxLength: 500 },
            logoUrl: { type: 'string', format: 'uri' },
          },
        },
      },
    },
    OrgController.createOrg,
  );

  // GET /api/v1/orgs/:orgId - Get organization
  fastify.get<{ Params: { orgId: string } }>(
    '/orgs/:orgId',
    {
      preHandler: [identityRequired, requireOnboardingStep('always')],
    },
    OrgController.getOrg,
  );
}
