import z from 'zod';
import {
  loginRequestSchema,
  registerRequestSchema,
  resendOtpRequestSchema,
  verifyRequestSchema,
} from '../schemas/request';

export type LoginRequestType = z.infer<typeof loginRequestSchema>;
export type ResendOtpRequestType = z.infer<typeof resendOtpRequestSchema>;
export type VerifyRequestType = z.infer<typeof verifyRequestSchema>;
export type RegisterRequestType = z.infer<typeof registerRequestSchema>;
