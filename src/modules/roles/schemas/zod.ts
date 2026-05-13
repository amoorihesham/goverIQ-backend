import { object, string, array } from 'zod';

export const listRolesInOrganizationRequestSchema = {
  params: object({
    orgId: string(),
  }),
};

export const listPermissionsInRoleRequestSchema = {
  params: object({
    roleId: string(),
    orgId: string(),
  }),
};
export const getRoleDetailsRequestSchema = {
  params: object({
    roleId: string(),
    orgId: string(),
  }),
};

export const listRolesRequestSchema = {
  params: object({
    orgId: string(),
  }),
};

export const createRoleRequestSchema = {
  params: object({ orgId: string() }),
  body: object({
    name: string(),
    permissions: array(string()),
  }),
};

export const updateRoleRequestSchema = {
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
  params: object({
    roleId: string(),
    orgId: string(),
  }),
};
