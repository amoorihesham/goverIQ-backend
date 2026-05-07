import { infer as zInfer } from 'zod';

import {
  loginRequestSchema,
  registerRequestSchema,
  resendOtpRequestSchema,
  verifyRequestSchema,
} from '../schemas/zod';

export type LoginRequestType = zInfer<(typeof loginRequestSchema)['body']>;
export type ResendOtpRequestType = zInfer<(typeof resendOtpRequestSchema)['body']>;
export type VerifyRequestType = zInfer<(typeof verifyRequestSchema)['body']>;
export type RegisterRequestType = zInfer<(typeof registerRequestSchema)['body']>;
