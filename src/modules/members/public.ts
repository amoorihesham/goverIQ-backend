import { logger } from '@/shared/logger';

export { memberRoutes } from './member.routes';

export const membersLogger = logger.child({ context: 'members' });
