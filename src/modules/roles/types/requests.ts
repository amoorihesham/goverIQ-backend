import { infer as zInfer } from 'zod';
import {
  createRoleRequestSchema,
  getRoleRequestSchema,
  listPermissionRequestSchema,
  listRolesRequestSchema,
  updateRoleRequestSchema,
} from '../schemas/zod';

export type ListPermissionRequest = zInfer<(typeof listPermissionRequestSchema)['params']>;
export type ListRolesRequest = zInfer<(typeof listRolesRequestSchema)['params']>;
export type GetRoleRequest = zInfer<(typeof getRoleRequestSchema)['params']>;
export type CreateRoleRequestParams = zInfer<(typeof createRoleRequestSchema)['params']>;
export type CreateRoleRequestBody = zInfer<(typeof createRoleRequestSchema)['body']>;
export type UpdateRoleRequestParams = zInfer<(typeof updateRoleRequestSchema)['params']>;
export type UpdateRoleRequestBody = zInfer<(typeof updateRoleRequestSchema)['body']>;
export type DeleteRoleRequest = zInfer<(typeof getRoleRequestSchema)['params']>;
