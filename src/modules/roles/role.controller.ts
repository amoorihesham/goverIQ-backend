import type { FastifyRequest, FastifyReply } from 'fastify';

import { createRoleService } from './role.service';
import { DatabaseClient } from '@/shared/database/types';
import {
  CreateRoleRequestBody,
  CreateRoleRequestParams,
  DeleteRoleRequest,
  GetRoleRequest,
  ListPermissionRequest,
  ListRolesInOrganizationRequest,
  UpdateRoleRequestBody,
  UpdateRoleRequestParams,
} from './types/requests';
import { contextFromRequest } from '@/shared/http/context';
import { success } from '@/shared/errors/envelope';

export const createRoleController = (db: DatabaseClient) => {
  const service = createRoleService(db);

  return {
    async listRoles(request: FastifyRequest<{ Params: ListRolesInOrganizationRequest }>, reply: FastifyReply) {
      const { orgId, userId } = contextFromRequest(request);
      const roles = await service.listRoles(userId!, orgId!);
      return reply.status(200).send(success({ message: 'Roles retrieved successfully', data: roles }));
    },
    async getRoleDetails(request: FastifyRequest<{ Params: GetRoleRequest }>, reply: FastifyReply) {
      const { orgId, userId } = contextFromRequest(request);
      const role = await service.getRole(userId!, orgId!, request.params.roleId);
      return reply.status(200).send(success({ message: 'Role details retrieved successfully', data: role }));
    },
    async listPermissions(request: FastifyRequest<{ Params: ListPermissionRequest }>, reply: FastifyReply) {
      const { orgId, userId } = contextFromRequest(request);
      const permissions = await service.listPermissions(userId!, orgId!, request.params.roleId);
      return reply.send(
        success({
          message: 'Permissions retrieved successfully',
          data: permissions,
        }),
      );
    },

    async createRole(
      request: FastifyRequest<{ Params: CreateRoleRequestParams; Body: CreateRoleRequestBody }>,
      reply: FastifyReply,
    ) {
      const { reqId, orgId, userId } = contextFromRequest(request);

      const role = await service.createRole(userId!, orgId!, reqId, request.body);
      return reply.code(201).send(success({ message: 'Role created successfully', data: role }));
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
