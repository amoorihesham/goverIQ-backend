import z from 'zod';

import {
  loginRequestSchema,
  registerRequestSchema,
  resendOtpRequestSchema,
  verifyRequestSchema,
} from './request';

export const registerRequestJsonSchema = {
  body: z.toJSONSchema(registerRequestSchema, {
    target: 'draft-07',
  }),
};
export const verifyRequestJsonSchema = {
  body: z.toJSONSchema(verifyRequestSchema, {
    target: 'draft-07',
  }),
};
export const resendOtpRequestJsonSchema = {
  body: z.toJSONSchema(resendOtpRequestSchema, {
    target: 'draft-07',
  }),
};
export const loginRequestJsonSchema = {
  body: z.toJSONSchema(loginRequestSchema, {
    target: 'draft-07',
  }),
};
