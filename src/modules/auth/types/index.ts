export interface AuthModuleConfig {
  ENV: string;
  JWT_SECRET: string;

  OTP_TTL_MS: number;
  OTP_RESEND_COOLDOWN_SEC: number;

  ACCESS_TTL_SECONDS: number;
  REFRESH_TTL_SECONDS: number;
  REFRESH_COOKIE_NAME: string;
}
