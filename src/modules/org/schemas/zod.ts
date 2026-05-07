import z from 'zod';

export const createOrganizationSchema = {
  body: z.object({
    name: z.string().min(4, 'Organization name must be at least 4 characters.'),
    description: z.string().optional(),
    logo: z.url().optional(),
  }),
};

export const getOrganizationSchema = {
  params: z.object({
    orgId: z.string().min(32, 'Organization id must be set.'),
  }),
};

export const updateOrganizationSchema = {
  body: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    logo: z.url().optional(),
  }),
  params: getOrganizationSchema.params,
};
