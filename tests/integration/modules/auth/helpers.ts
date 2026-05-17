import { users } from "@/db/schema";
import { hashPassword } from "@/modules/auth/public";
import { db } from "@/shared/database/client";
import { randomUUID } from "crypto";

export function uniqueEmail() {
  return `reg-${randomUUID()}@test.example`;
}

export async function createVerifiedUser(email: string, password: string) {
  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash, isVerified: true })
    .returning();
  return user!;
}