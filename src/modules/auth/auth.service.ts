import { and, count, eq } from 'drizzle-orm';

import {
  LoginRequestType,
  RegisterRequestType,
  ResendOtpRequestType,
  VerifyRequestType,
} from './types/request';
import { generateOtp, hashOtp } from './utils/otp';
import { dummyVerifyPassword, hashPassword, verifyPassword } from './utils/password';
import {
  generateRefreshTokenCleartext,
  hashRefreshToken,
  parseUserIdFromCleartext,
} from './utils/tokens';

import { emailVerifications, refreshTokens, users } from '@/db/schema';
import { emitAudit } from '@/shared/audit/emitter';
import { signAccessToken } from '@/shared/auth/jwt';
import { env } from '@/shared/config/env';
import type { Tx } from '@/shared/database/transaction';
import type { DatabaseClient } from '@/shared/database/types';
import { AppError } from '@/shared/errors/http-error';
import { logger } from '@/shared/logger';
import { notificationService } from '@/shared/notifications/service';
import { buildEmailVerificationEmail } from '@/shared/notifications/templates/email-verification';

export interface SessionResult {
  accessToken: string;
  refreshTokenCleartext: string;
}

export function createAuthService(db: DatabaseClient) {
  async function issueSessionWithinTx(
    tx: Tx,
    user: { id: string; email: string },
  ): Promise<SessionResult> {
    const refreshTokenCleartext = generateRefreshTokenCleartext(user.id);
    const tokenHash = hashRefreshToken(refreshTokenCleartext);

    await tx.delete(refreshTokens).where(eq(refreshTokens.userId, user.id));
    await tx.insert(refreshTokens).values({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + env.REFRESH_TTL_SECONDS * 1000),
    });

    const accessToken = await signAccessToken(
      { sub: user.id, email: user.email },
      env.JWT_SECRET,
      env.ACCESS_TTL_SECONDS,
    );

    return { accessToken, refreshTokenCleartext };
  }

  function sendOtpEmail(email: string, code: string): void {
    const { subject, text } = buildEmailVerificationEmail({
      otp: code,
      expiresInMinutes: Math.round(env.OTP_TTL_MS / 1000 / 60),
    });
    notificationService
      .send(email, subject, text)
      .catch((err) => logger.error({ err }, 'Failed to send OTP email'));
  }

  return {
    async register(input: RegisterRequestType): Promise<void> {
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
        // onConflictDoNothing makes the INSERT atomic: if two concurrent
        // transactions both pass the findFirst check above (both see no row)
        // and race to INSERT, the loser gets an empty result instead of a
        // 23505 constraint error. No try/catch needed in the service.
        const [createdUser] = await tx
          .insert(users)
          .values({ email: input.email, passwordHash })
          .onConflictDoNothing()
          .returning();
        if (!createdUser) throw AppError.duplicateEmail();

        await tx.insert(emailVerifications).values({
          userId: createdUser!.id,
          otpHash,
          expiresAt: new Date(Date.now() + env.OTP_TTL_MS),
          lastSentAt: new Date(),
        });

        await emitAudit(tx, {
          entityType: 'user',
          event: 'user.registered',
          actorId: createdUser!.id,
          entityId: createdUser!.id,
          payload: { data: { email: input.email } },
          orgId: null,
        });
      });

      sendOtpEmail(input.email, code);
    },

    async verifyEmail(input: VerifyRequestType): Promise<SessionResult> {
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

        const session = await issueSessionWithinTx(tx as unknown as Tx, user);

        await emitAudit(tx, {
          entityType: 'user',
          event: 'user.verified',
          actorId: user.id,
          entityId: user.id,
          payload: { data: { email: user.email } },
          orgId: null,
        });

        return session;
      });
    },

    async login(input: LoginRequestType): Promise<SessionResult> {
      return db.transaction(async (tx: Tx) => {
        const user = await tx.query.users.findFirst({
          where: eq(users.email, input.email),
        });

        if (!user) {
          await dummyVerifyPassword(input.password);
          throw AppError.invalidCredentials();
        }

        const passwordOk = await verifyPassword(input.password, user.passwordHash);
        if (!passwordOk || !user.isVerified) {
          throw AppError.invalidCredentials();
        }

        const session = await issueSessionWithinTx(tx as unknown as Tx, user);

        await emitAudit(tx, {
          entityType: 'user',
          event: 'user.login',
          actorId: user.id,
          entityId: user.id,
          payload: { data: { email: user.email } },
          orgId: null,
        });

        return session;
      });
    },

    async refresh(cleartext: string | undefined): Promise<SessionResult> {
      if (!cleartext) throw AppError.unauthorized();

      const tokenHash = hashRefreshToken(cleartext);
      const row = await db.query.refreshTokens.findFirst({
        where: eq(refreshTokens.tokenHash, tokenHash),
      });

      if (!row) {
        const userId = parseUserIdFromCleartext(cleartext);
        if (userId) {
          await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
        }
        throw AppError.unauthorized();
      }

      if (row.expiresAt < new Date()) {
        await db.delete(refreshTokens).where(eq(refreshTokens.id, row.id));
        throw AppError.unauthorized();
      }

      const user = await db.query.users.findFirst({ where: eq(users.id, row.userId) });
      if (!user) {
        await db.delete(refreshTokens).where(eq(refreshTokens.id, row.id));
        throw AppError.unauthorized();
      }

      return db.transaction(async (tx: Tx) => {
        await tx.delete(refreshTokens).where(eq(refreshTokens.id, row.id));
        return issueSessionWithinTx(tx, user);
      });
    },

    async logout(cleartext: string | undefined): Promise<{ deleted: boolean }> {
      if (!cleartext) return { deleted: false };

      return db.transaction(async (tx: Tx) => {
        const tokenHash = hashRefreshToken(cleartext);
        const row = await tx.query.refreshTokens.findFirst({
          where: eq(refreshTokens.tokenHash, tokenHash),
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
          payload: { data: { sessionsRemaining: remaining } },
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
        if (secondsSinceLastSent < env.OTP_RESEND_COOLDOWN_SEC) {
          throw AppError.otpCooldown();
        }

        const code = generateOtp();
        const otpHash = hashOtp(code);
        await tx
          .update(emailVerifications)
          .set({
            otpHash,
            expiresAt: new Date(Date.now() + env.OTP_TTL_MS),
            lastSentAt: new Date(),
          })
          .where(and(eq(emailVerifications.userId, user.id)));

        pendingCode = code;
      });

      if (pendingCode) {
        sendOtpEmail(input.email, pendingCode);
      }
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
