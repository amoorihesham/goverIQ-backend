import type { FastifyRequest, FastifyReply } from 'fastify';

import { MemberService } from './member.service';

interface SendInvitationBody {
  email: string;
  roleId: string;
}

interface AcceptInvitationBody {
  password?: string;
}

export class MemberController {
  /**
   * POST /api/v1/orgs/:orgId/members/invitations - Send invitation
   */
  static async sendInvitation(request: FastifyRequest, reply: FastifyReply) {
    const orgId = (request.params as { orgId: string }).orgId;
    const body = request.body as SendInvitationBody;
    const invitation = await MemberService.sendInvitation(
      request.user!.userId,
      orgId,
      body,
    );
    return reply.code(201).send({
      success: true,
      data: invitation,
    });
  }

  /**
   * POST /invitations/:token/accept - Accept invitation (public)
   */
  static async acceptInvitation(request: FastifyRequest, reply: FastifyReply) {
    const token = (request.params as { token: string }).token;
    const body = request.body as AcceptInvitationBody | undefined;
    const result = await MemberService.acceptInvitation(token, body);

    const response = reply.send({
      success: true,
      data: {
        membership: result.membership,
        accessToken: result.accessToken,
      },
    });

    // Set refresh token cookie for new users
    if (result.refreshTokenCleartext) {
      reply.setCookie(
        'refresh_token',
        result.refreshTokenCleartext,
        {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
        },
      );
    }

    return response;
  }

  /**
   * POST /invitations/:token/decline - Decline invitation (public)
   */
  static async declineInvitation(request: FastifyRequest, reply: FastifyReply) {
    const token = (request.params as { token: string }).token;
    const result = await MemberService.declineInvitation(token);
    return reply.send({
      success: true,
      data: result,
    });
  }

  /**
   * GET /api/v1/orgs/:orgId/members - List members
   */
  static async listMembers(request: FastifyRequest, reply: FastifyReply) {
    const orgId = (request.params as { orgId: string }).orgId;
    const query = request.query as { cursor?: string; limit?: string };
    const limit = Math.min(parseInt(query.limit || '20', 10), 100);
    const members = await MemberService.listMembers(
      request.user!.userId,
      orgId,
      query.cursor,
      limit,
    );
    return reply.send({
      success: true,
      data: members,
    });
  }

  /**
   * DELETE /api/v1/orgs/:orgId/members/:memberId - Remove member
   */
  static async removeMember(request: FastifyRequest, reply: FastifyReply) {
    const { orgId, memberId } = request.params as {
      orgId: string;
      memberId: string;
    };
    await MemberService.removeMember(request.user!.userId, orgId, memberId);
    return reply.code(204).send();
  }

  /**
   * PUT /api/v1/orgs/:orgId/members/:memberId/role - Assign role
   */
  static async assignMemberRole(request: FastifyRequest, reply: FastifyReply) {
    const { orgId, memberId } = request.params as {
      orgId: string;
      memberId: string;
    };
    const body = request.body as { roleId: string };
    const membership = await MemberService.assignMemberRole(
      request.user!.userId,
      orgId,
      memberId,
      body.roleId,
    );
    return reply.send({
      success: true,
      data: membership,
    });
  }

  /**
   * DELETE /api/v1/orgs/:orgId/members/:memberId/role - Revoke role
   */
  static async revokeMemberRole(request: FastifyRequest, reply: FastifyReply) {
    const { orgId, memberId } = request.params as {
      orgId: string;
      memberId: string;
    };
    await MemberService.revokeMemberRole(request.user!.userId, orgId, memberId);
    return reply.code(204).send();
  }
}
