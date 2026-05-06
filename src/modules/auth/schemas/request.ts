import z from 'zod';

import { OTP_LENGTH, PASSWORD_MIN_LENGTH } from '../constants';

export const registerRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(100),
});

export const verifyRequestSchema = z.object({
  email: z.email(),
  otp: z
    .string()
    .length(OTP_LENGTH)
    .regex(/^\d+$/),
});

export const resendOtpRequestSchema = z.object({
  email: z.email(),
});

export const loginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(100),
});
