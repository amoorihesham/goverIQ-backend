import { object, string, array } from 'zod';

export const listRolesInOrganizationRequestSchema = {
  summary: 'List all roles in organization.',
  params: object({
    orgId: string(),
  }),
};

export const listPermissionsInRoleRequestSchema = {
  summary: 'List permission in a single role in organization.',
  params: object({
    roleId: string(),
    orgId: string(),
  }),
};
export const getRoleDetailsRequestSchema = {
  summary: 'Get role details.',
  params: object({
    roleId: string(),
    orgId: string(),
  }),
};

export const createRoleRequestSchema = {
  summary: 'Create new role.',
  params: object({ orgId: string() }),
  body: object({
    name: string(),
    permissions: array(string()),
  }),
};

export const updateRoleRequestSchema = {
  summary: 'Update role data.',
  params: object({
    roleId: string(),
    orgId: string(),
  }),
  body: object({
    name: string().optional(),
    permissions: array(string()).optional(),
  }),
};

export const deleteRoleRequestSchema = {
  summary: 'Delete role.',
  params: object({
    roleId: string(),
    orgId: string(),
  }),
};
