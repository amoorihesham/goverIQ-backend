export { authRoutes } from './auth.routes';
export { generateOtp, hashOtp } from './utils/otp';
export { hashPassword, verifyPassword } from './utils/password';
export { generateRefreshTokenCleartext, hashRefreshToken, parseUserIdFromCleartext } from './utils/tokens';
export { CONFIGURATIONS } from './constants';

import { logger } from '@/shared/logger';

export const authLogger = logger.child({ context: 'auth' });
