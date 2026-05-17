import { InferSelectModel } from 'drizzle-orm';

import { users } from '@/db/schema';

export function toUserResponseDto(user: InferSelectModel<typeof users>) {
  return {
    id: user.id,
    email: user.email,
    isVerified: user.isVerified,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
