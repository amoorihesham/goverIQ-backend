import type { FastifyRequest, FastifyReply } from 'fastify';

import { createRoleService } from './role.service';
import { DatabaseClient } from '@/shared/database/types';
import {
  CreateRoleRequestBody,
  CreateRoleRequestParams,
  DeleteRoleRequest,
  GetRoleRequest,
  ListPermissionRequest,
  ListRolesRequest,
  UpdateRoleRequestBody,
  UpdateRoleRequestParams,
} from './types/requests';
import { contextFromRequest } from '@/shared/http/context';

export const createRoleController = (db: DatabaseClient) => {
  const service = createRoleService(db);

  return {
    async listPermissions(request: FastifyRequest<{ Params: ListPermissionRequest }>, reply: FastifyReply) {
      const permissions = await service.listPermissions();
      return reply.send({
        success: true,
        data: permissions,
      });
    },

    async createRole(
      request: FastifyRequest<{ Params: CreateRoleRequestParams; Body: CreateRoleRequestBody }>,
      reply: FastifyReply,
    ) {
      const { reqId, orgId, userId } = contextFromRequest(request);

      const role = await service.createRole(userId!, orgId!, reqId, request.body);
      return reply.code(201).send({
        success: true,
        data: role,
      });
    },

    async listRoles(request: FastifyRequest<{ Params: ListRolesRequest }>, reply: FastifyReply) {
      const { orgId, userId } = contextFromRequest(request);
      const roles = await service.listRoles(userId!, orgId!);
      return reply.send({
        success: true,
        data: roles,
      });
    },

    async getRole(request: FastifyRequest<{ Params: GetRoleRequest }>, reply: FastifyReply) {
      const { orgId, userId } = contextFromRequest(request);
      const role = await service.getRole(userId!, orgId!, request.params.roleId);
      return reply.send({
        success: true,
        data: role,
      });
    },

    async updateRole(
      request: FastifyRequest<{ Params: UpdateRoleRequestParams; Body: UpdateRoleRequestBody }>,
      reply: FastifyReply,
    ) {
      const { reqId, orgId, userId } = contextFromRequest(request);
      const role = await service.updateRole(userId!, orgId!, reqId, request.params.roleId, request.body);
      return reply.send({
        success: true,
        data: role,
      });
    },

    async deleteRole(request: FastifyRequest<{ Params: DeleteRoleRequest }>, reply: FastifyReply) {
      const { reqId, orgId, userId } = contextFromRequest(request);
      await service.deleteRole(userId!, orgId!, reqId, request.params.roleId);
      return reply.code(204).send();
    },
  };
};
