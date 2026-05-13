import { env } from '@/shared/config/env';

export const CONFIGURATIONS = {
  PASSWORD_MIN_LENGTH: env.NODE_ENV === 'production' ? 12 : 6,
  PASSWORD_SALT_ROUNDS: env.NODE_ENV === 'production' ? 12 : 5,
  OTP_LENGTH: 6,
  OTP_TTL_SECONDS: 600,
  OTP_RESEND_COOLDOWN_SECONDS: 60,
  ACCESS_TTL_SECONDS: 900,
  REFRESH_TTL_SECONDS: 604800,
  ACCESS_TOKEN_COOKIE_NAME: 'access_token',
  REFRESH_TOKEN_COOKIE_NAME: 'refresh_token',
};
