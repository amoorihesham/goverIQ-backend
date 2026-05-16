import { object, email, string } from 'zod';

import { CONFIGURATIONS } from '../constants';

export const registerRequestSchema = {
  summary: 'Register new account.',
  body: object({
    email: email(),
    password: string().min(CONFIGURATIONS.PASSWORD_MIN_LENGTH).max(100),
  }),
};

export const verifyRequestSchema = {
  summary: 'Verify email.',
  body: object({
    email: email(),
    otp: string().length(CONFIGURATIONS.OTP_LENGTH).regex(/^\d+$/),
  }),
};

export const resendOtpRequestSchema = {
  summary: 'Resend OTP.',
  body: object({
    email: email(),
  }),
};

export const loginRequestSchema = {
  summary: 'Login to account.',
  body: object({
    email: email(),
    password: string().min(CONFIGURATIONS.PASSWORD_MIN_LENGTH).max(100),
  }),
};

export const refreshRequestSchema = {
  summary: 'Rotate refresh token.',
  headers: object({
    cookie: object({
      refresh_token: string(),
    }),
  }),
};
