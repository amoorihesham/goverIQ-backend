import type { FastifyRequest, FastifyReply } from 'fastify';

import { RoleService } from './role.service';

interface CreateRoleBody {
  name: string;
  permissions: string[];
}

interface UpdateRoleBody {
  name?: string;
  permissions?: string[];
}

export class RoleController {
  /**
   * GET /api/v1/orgs/:orgId/roles/permissions - List all permissions
   */
  static async listPermissions(request: FastifyRequest, reply: FastifyReply) {
    const permissions = await RoleService.listPermissions();
    return reply.send({
      success: true,
      data: permissions,
    });
  }

  /**
   * POST /api/v1/orgs/:orgId/roles - Create role
   */
  static async createRole(request: FastifyRequest, reply: FastifyReply) {
    const orgId = (request.params as { orgId: string }).orgId;
    const body = request.body as CreateRoleBody;
    const role = await RoleService.createRole(request.user!.userId, orgId, body);
    return reply.code(201).send({
      success: true,
      data: role,
    });
  }

  /**
   * GET /api/v1/orgs/:orgId/roles - List roles
   */
  static async listRoles(request: FastifyRequest, reply: FastifyReply) {
    const orgId = (request.params as { orgId: string }).orgId;
    const roles = await RoleService.listRoles(request.user!.userId, orgId);
    return reply.send({
      success: true,
      data: roles,
    });
  }

  /**
   * GET /api/v1/orgs/:orgId/roles/:roleId - Get specific role
   */
  static async getRole(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const { orgId, roleId } = request.params as {
      orgId: string;
      roleId: string;
    };
    const role = await RoleService.getRole(request.user!.userId, orgId, roleId);
    return reply.send({
      success: true,
      data: role,
    });
  }

  /**
   * PATCH /api/v1/orgs/:orgId/roles/:roleId - Update role
   */
  static async updateRole(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const { orgId, roleId } = request.params as {
      orgId: string;
      roleId: string;
    };
    const body = request.body as UpdateRoleBody;
    const role = await RoleService.updateRole(
      request.user!.userId,
      orgId,
      roleId,
      body,
    );
    return reply.send({
      success: true,
      data: role,
    });
  }

  /**
   * DELETE /api/v1/orgs/:orgId/roles/:roleId - Delete role
   */
  static async deleteRole(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const { orgId, roleId } = request.params as {
      orgId: string;
      roleId: string;
    };
    await RoleService.deleteRole(request.user!.userId, orgId, roleId);
    return reply.code(204).send();
  }
}
