import type { FastifyRequest, FastifyReply } from 'fastify';

import { OrgService } from './org.service';

interface CreateOrgBody {
  name: string;
  description?: string;
  logoUrl?: string;
}

interface UpdateOrgBody {
  name?: string;
  description?: string;
  logoUrl?: string;
}

export class OrgController {
  /**
   * POST /api/v1/orgs - Create organization
   */
  static async createOrg(request: FastifyRequest, reply: FastifyReply) {
    const org = await OrgService.createOrg(request.user!.userId, request.body as CreateOrgBody);
    return reply.code(201).send({
      success: true,
      data: org,
    });
  }

  /**
   * GET /api/v1/orgs/:orgId - Get organization
   */
  static async getOrg(request: FastifyRequest, reply: FastifyReply) {
    const orgId = (request.params as { orgId: string }).orgId;
    const org = await OrgService.getOrg(request.user!.userId, orgId);
    return reply.send({
      success: true,
      data: org,
    });
  }

  /**
   * GET /api/v1/orgs/:orgId/onboarding - Get onboarding step
   */
  static async getOnboardingStep(request: FastifyRequest, reply: FastifyReply) {
    const orgId = (request.params as { orgId: string }).orgId;
    const step = await OrgService.getOnboardingStep(request.user!.userId, orgId);
    return reply.send({
      success: true,
      data: step,
    });
  }

  /**
   * POST /api/v1/orgs/:orgId/onboarding/skip - Skip to COMPLETE
   */
  static async skipOnboarding(request: FastifyRequest, reply: FastifyReply) {
    const orgId = (request.params as { orgId: string }).orgId;
    const result = await OrgService.skipOnboarding(request.user!.userId, orgId);
    return reply.send({
      success: true,
      data: result,
    });
  }

  /**
   * PATCH /api/v1/orgs/:orgId - Update organization
   */
  static async updateOrg(request: FastifyRequest, reply: FastifyReply) {
    const orgId = (request.params as { orgId: string }).orgId;
    const body = request.body as UpdateOrgBody;
    const org = await OrgService.updateOrg(request.user!.userId, orgId, body);
    return reply.send({
      success: true,
      data: org,
    });
  }

  /**
   * DELETE /api/v1/orgs/:orgId - Archive organization
   */
  static async archiveOrg(request: FastifyRequest, reply: FastifyReply) {
    const orgId = (request.params as { orgId: string }).orgId;
    await OrgService.archiveOrg(request.user!.userId, orgId);
    return reply.code(204).send();
  }
}
