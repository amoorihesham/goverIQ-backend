import { object, email, string } from 'zod';

import { CONFIGURATIONS } from '../constants';

export const registerRequestSchema = {
  body: object({
    email: email(),
    password: string().min(CONFIGURATIONS.PASSWORD_MIN_LENGTH).max(100),
  }),
};

export const verifyRequestSchema = {
  body: object({
    email: email(),
    otp: string().length(CONFIGURATIONS.OTP_LENGTH).regex(/^\d+$/),
  }),
};

export const resendOtpRequestSchema = {
  body: object({
    email: email(),
  }),
};

export const loginRequestSchema = {
  body: object({
    email: email(),
    password: string().min(CONFIGURATIONS.PASSWORD_MIN_LENGTH).max(100),
  }),
};
