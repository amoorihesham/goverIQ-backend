import { infer as zInfer } from 'zod';
import {
  createRoleRequestSchema,
  deleteRoleRequestSchema,
  getRoleDetailsRequestSchema,
  listPermissionsInRoleRequestSchema,
  listRolesInOrganizationRequestSchema,
  updateRoleRequestSchema,
} from '../schemas/zod';

export type ListRolesInOrganizationRequest = zInfer<(typeof listRolesInOrganizationRequestSchema)['params']>;
export type GetRoleRequest = zInfer<(typeof getRoleDetailsRequestSchema)['params']>;
export type ListPermissionRequest = zInfer<(typeof listPermissionsInRoleRequestSchema)['params']>;
export type CreateRoleRequestParams = zInfer<(typeof createRoleRequestSchema)['params']>;
export type CreateRoleRequestBody = zInfer<(typeof createRoleRequestSchema)['body']>;
export type UpdateRoleRequestParams = zInfer<(typeof updateRoleRequestSchema)['params']>;
export type UpdateRoleRequestBody = zInfer<(typeof updateRoleRequestSchema)['body']>;
export type DeleteRoleRequest = zInfer<(typeof deleteRoleRequestSchema)['params']>;
