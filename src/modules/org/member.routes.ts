import type { FastifyInstance } from 'fastify';

import { MemberController } from './member.controller';
import { requireOnboardingStep } from './onboarding.prehandler';

import { identityRequired } from '@/shared/auth/identity';
import { requirePermission } from '@/shared/permissions/guard';

export async function memberRoutes(fastify: FastifyInstance) {
  // POST /api/v1/orgs/:orgId/members/invitations - Send invitation
  fastify.post<{
    Params: { orgId: string };
    Body: { email: string; roleId: string };
  }>(
    '/orgs/:orgId/members/invitations',
    {
      preHandler: [
        identityRequired,
        requireOnboardingStep('invitation'),
        requirePermission('member:invite'),
      ],
    },
    MemberController.sendInvitation,
  );

  // GET /api/v1/orgs/:orgId/members - List members
  fastify.get<{ Params: { orgId: string } }>(
    '/orgs/:orgId/members',
    {
      preHandler: [
        identityRequired,
        requireOnboardingStep('complete'),
      ],
    },
    MemberController.listMembers,
  );

  // DELETE /api/v1/orgs/:orgId/members/:memberId - Remove member
  fastify.delete<{ Params: { orgId: string; memberId: string } }>(
    '/orgs/:orgId/members/:memberId',
    {
      preHandler: [
        identityRequired,
        requireOnboardingStep('complete'),
        requirePermission('member:remove'),
      ],
    },
    MemberController.removeMember,
  );

  // PUT /api/v1/orgs/:orgId/members/:memberId/role - Assign role
  fastify.put<{
    Params: { orgId: string; memberId: string };
    Body: { roleId: string };
  }>(
    '/orgs/:orgId/members/:memberId/role',
    {
      preHandler: [
        identityRequired,
        requireOnboardingStep('complete'),
        requirePermission('member:update_role'),
      ],
    },
    MemberController.assignMemberRole,
  );

  // DELETE /api/v1/orgs/:orgId/members/:memberId/role - Revoke role
  fastify.delete<{ Params: { orgId: string; memberId: string } }>(
    '/orgs/:orgId/members/:memberId/role',
    {
      preHandler: [
        identityRequired,
        requireOnboardingStep('complete'),
        requirePermission('member:update_role'),
      ],
    },
    MemberController.revokeMemberRole,
  );
}
