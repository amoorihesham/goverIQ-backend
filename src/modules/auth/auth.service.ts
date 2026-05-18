import { and, count, eq } from 'drizzle-orm';

import { CONFIGURATIONS } from './constants';
import { toUserResponseDto } from './dtos/resposne';
import { LoginRequestType, RegisterRequestType, ResendOtpRequestType, VerifyRequestType } from './types/request';
import { generateOtp, hashOtp } from './utils/otp';
import { hashPassword, verifyPassword } from './utils/password';

import { emailVerifications, refreshTokens, users } from '@/db/schema';
import { emitAudit } from '@/shared/audit/emitter';
import { signToken, verifyToken } from '@/shared/auth/jwt';
import { env } from '@/shared/config/env';
import type { Tx } from '@/shared/database/transaction';
import type { DatabaseClient } from '@/shared/database/types';
import { AppError } from '@/shared/errors/http-error';
import type { NotificationDispatcher } from '@/shared/notifications/dispatcher';
<<<<<<< HEAD
<<<<<<< HEAD

=======
>>>>>>> main
=======
>>>>>>> 005-voting-minutes

export function createAuthService(db: DatabaseClient, dispatcher: NotificationDispatcher) {
  async function issueSessionWithinTx(tx: Tx, user: { id: string; email: string }) {
    const refreshToken = await signToken(
      { userId: user.id, email: user.email },
      env.JWT_REFRESH_SECRET,
      CONFIGURATIONS.REFRESH_TTL_SECONDS,
    );

    await tx.delete(refreshTokens).where(eq(refreshTokens.userId, user.id));
    await tx.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: refreshToken,
      expiresAt: new Date(Date.now() + CONFIGURATIONS.REFRESH_TTL_SECONDS * 1000),
    });

    const accessToken = await signToken(
      { userId: user.id, email: user.email },
      env.JWT_ACCESS_SECRET,
      CONFIGURATIONS.ACCESS_TTL_SECONDS,
    );

    return { accessToken, refreshToken };
  }

  return {
    async register(input: RegisterRequestType, reqId: string): Promise<void> {
      const code = generateOtp();
      const otpHash = hashOtp(code);

      await db.transaction(async (tx: Tx) => {
        const existing = await tx.query.users.findFirst({
          where: eq(users.email, input.email),
        });
        if (existing?.isVerified) throw AppError.duplicateEmail();
        if (existing) {
          await tx.delete(users).where(eq(users.id, existing.id));
        }

        const passwordHash = await hashPassword(input.password);

        const [createdUser] = await tx
          .insert(users)
          .values({ email: input.email, passwordHash })
          .onConflictDoNothing()
          .returning();
        if (!createdUser) throw AppError.duplicateEmail();

        await tx.insert(emailVerifications).values({
          userId: createdUser!.id,
          otpHash,
          expiresAt: new Date(Date.now() + CONFIGURATIONS.OTP_TTL_SECONDS * 1000),
          lastSentAt: new Date(),
        });

        await emitAudit(tx, {
          entityType: 'user',
          event: 'user.registered',
          actorId: createdUser!.id,
          entityId: createdUser!.id,
          payload: { data: { email: input.email }, reqId },
          orgId: null,
        });
      });

      dispatcher.enqueue('email-verification', input.email, {
        otp: code,
        expiresInMinutes: Math.round(CONFIGURATIONS.OTP_TTL_SECONDS / 60),
      });
    },

    async verifyEmail(input: VerifyRequestType, reqId: string): Promise<void> {
      return db.transaction(async (tx: Tx) => {
        const user = await tx.query.users.findFirst({
          where: eq(users.email, input.email),
        });
        if (!user) throw AppError.invalidCredentials();

        const verification = await tx.query.emailVerifications.findFirst({
          where: eq(emailVerifications.userId, user.id),
        });
        if (!verification) throw AppError.invalidCredentials();

        if (hashOtp(input.otp) !== verification.otpHash) {
          throw AppError.invalidCredentials();
        }
        if (verification.expiresAt < new Date()) {
          throw AppError.otpExpired();
        }

        await tx.update(users).set({ isVerified: true }).where(eq(users.id, user.id));
        await tx.delete(emailVerifications).where(eq(emailVerifications.userId, user.id));

        await emitAudit(tx, {
          entityType: 'user',
          event: 'user.verified',
          actorId: user.id,
          entityId: user.id,
          payload: { data: { email: user.email }, reqId },
          orgId: null,
        });
      });
    },

    async login(input: LoginRequestType, reqId: string) {
      return db.transaction(async (tx: Tx) => {
        const user = await tx.query.users.findFirst({
          where: eq(users.email, input.email),
        });

        if (!user) throw AppError.invalidCredentials();

        const passwordOk = await verifyPassword(input.password, user.passwordHash);
        if (!passwordOk || !user.isVerified) throw AppError.invalidCredentials();

        const session = await issueSessionWithinTx(tx as unknown as Tx, user);

        await emitAudit(tx, {
          entityType: 'user',
          event: 'user.login',
          actorId: user.id,
          entityId: user.id,
          payload: { data: { email: user.email }, reqId },
          orgId: null,
        });

        return { ...session, user: toUserResponseDto(user) };
      });
    },

    async refresh(refreshToken: string) {
      const token = await db.query.refreshTokens.findFirst({
        where: eq(refreshTokens.tokenHash, refreshToken),
      });

      if (!token) {
        const { userId } = await verifyToken(refreshToken, env.JWT_REFRESH_SECRET);
        if (userId) {
          await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
        }
        throw AppError.unauthorized();
      }

      if (token.expiresAt < new Date()) {
        await db.delete(refreshTokens).where(eq(refreshTokens.id, token.id));
        throw AppError.unauthorized();
      }

      const user = await db.query.users.findFirst({ where: eq(users.id, token.userId) });
      if (!user) {
        await db.delete(refreshTokens).where(eq(refreshTokens.id, token.id));
        throw AppError.unauthorized();
      }

      return db.transaction(async (tx: Tx) => {
        await tx.delete(refreshTokens).where(eq(refreshTokens.id, token.id));
        const session = await issueSessionWithinTx(tx, user);

        return { ...session, user: toUserResponseDto(user) };
      });
    },

    async logout(refreshToken: string, reqId: string): Promise<{ deleted: boolean }> {
      return db.transaction(async (tx: Tx) => {
        const row = await tx.query.refreshTokens.findFirst({
          where: eq(refreshTokens.tokenHash, refreshToken),
        });

        if (!row) return { deleted: false };

        await tx.delete(refreshTokens).where(eq(refreshTokens.id, row.id));

        const [{ value: remaining }] = await tx
          .select({ value: count() })
          .from(refreshTokens)
          .where(eq(refreshTokens.userId, row.userId));

        await emitAudit(tx, {
          entityType: 'user',
          event: 'user.logout',
          actorId: row.userId,
          entityId: row.userId,
          payload: { data: { sessionsRemaining: remaining }, reqId },
          orgId: null,
        });

        return { deleted: true };
      });
    },

    async resendOtp(input: ResendOtpRequestType): Promise<void> {
      let pendingCode: string | null = null;

      await db.transaction(async (tx: Tx) => {
        const user = await tx.query.users.findFirst({
          where: eq(users.email, input.email),
        });
        if (!user || user.isVerified) throw AppError.otpCooldown();

        const verification = await tx.query.emailVerifications.findFirst({
          where: eq(emailVerifications.userId, user.id),
        });
        if (!verification) throw AppError.otpCooldown();

        const secondsSinceLastSent = (Date.now() - verification.lastSentAt.getTime()) / 1000;
        if (secondsSinceLastSent < CONFIGURATIONS.OTP_RESEND_COOLDOWN_SECONDS) {
          throw AppError.otpCooldown();
        }

        const code = generateOtp();
        const otpHash = hashOtp(code);
        await tx
          .update(emailVerifications)
          .set({
            otpHash,
            expiresAt: new Date(Date.now() + CONFIGURATIONS.OTP_TTL_SECONDS * 1000),
            lastSentAt: new Date(),
          })
          .where(and(eq(emailVerifications.userId, user.id)));

        pendingCode = code;
      });

      if (pendingCode) {
        dispatcher.enqueue('email-verification', input.email, {
          otp: pendingCode,
          expiresInMinutes: CONFIGURATIONS.OTP_TTL_SECONDS / 60,
        });
      }
    },
  };
}
