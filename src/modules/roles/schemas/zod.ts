import { object, string, array } from 'zod';

export const listPermissionRequestSchema = {
  params: object({
    orgId: string(),
  }),
};

export const listRolesRequestSchema = {
  params: object({
    orgId: string(),
  }),
};

export const getRoleRequestSchema = {
  params: object({
    orgId: string(),
    roleId: string(),
  }),
};

export const createRoleRequestSchema = {
  params: object({
    orgId: string(),
  }),
  body: object({
    name: string(),
    permissions: array(string()),
  }),
};

export const updateRoleRequestSchema = {
  params: object({
    orgId: string(),
    roleId: string(),
  }),
  body: object({
    name: string().optional(),
    permissions: array(string()).optional(),
  }),
};
