import { infer as zInfer } from 'zod';

import { createOrganizationSchema, getOrganizationSchema, updateOrganizationSchema } from '../schemas/zod';

export type CreateOrganizationRequestType = zInfer<(typeof createOrganizationSchema)['body']>;
export type UpdateOrganizationRequestType = zInfer<(typeof updateOrganizationSchema)['body']>;
export type OrganizationIdParamRequestType = zInfer<(typeof getOrganizationSchema)['params']>;
