import z from 'zod';

import {
  createOrganizationSchema,
  getOrganizationSchema,
  updateOrganizationSchema,
} from '../schemas/zod';

export type CreateOrganizationRequestType = z.infer<(typeof createOrganizationSchema)['body']>;
export type UpdateOrganizationRequestType = z.infer<(typeof updateOrganizationSchema)['body']>;
export type OrganizationIdParamRequestType = z.infer<(typeof getOrganizationSchema)['params']>;
