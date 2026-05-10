import nodemailer from 'nodemailer';

import type { NotificationTemplate } from './dispatcher';
import { buildEmailVerificationEmail, EmailVerificationPayload } from './templates/email-verification';
import { buildInvitationEmail, InvitationPayload } from './templates/invitation';

import { logger } from '@/shared/logger';

let _transport: nodemailer.Transporter | null = null;

function getTransport(): nodemailer.Transporter {
  if (_transport) return _transport;

  const nodeEnv = process.env.NODE_ENV || 'development';

  if (nodeEnv === 'test') {
    _transport = nodemailer.createTransport({ jsonTransport: true });
    return _transport;
  }

  if (nodeEnv === 'development') {
    _transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '1025', 10),
      secure: false,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    });
    return _transport;
  }

  _transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE !== 'false',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
  return _transport;
}

export async function sendNotification(
  template: NotificationTemplate,
  to: string,
  data: InvitationPayload | EmailVerificationPayload,
): Promise<void> {
  let subject: string;
  let text: string;

  if (template === 'email-verification') {
    ({ subject, text } = buildEmailVerificationEmail(data as EmailVerificationPayload));
  } else if (template === 'invitation') {
    ({ subject, text } = buildInvitationEmail(data as InvitationPayload));
  } else {
    logger.warn({ template }, 'Unknown notification template');
    return;
  }

  const transport = getTransport();
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || 'noreply@groven.local',
      to,
      subject,
      text,
    });
  } catch (err) {
    logger.error({ err, to: '[REDACTED]', template }, 'Failed to send notification');
    throw err; // re-throw so BullMQ retry logic triggers
  }
}
