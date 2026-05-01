import nodemailer from 'nodemailer';
import pino from 'pino';

const logger = pino();

export interface NotificationService {
  send(to: string, subject: string, text: string): Promise<void>;
}

function createTransport(): nodemailer.Transporter {
  const nodeEnv = process.env.NODE_ENV || 'development';

  if (nodeEnv === 'test') {
    return nodemailer.createTransport({ jsonTransport: true });
  }

  if (nodeEnv === 'development') {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '1025', 10),
      secure: false,
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
          }
        : undefined,
    });
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE !== 'false',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });
}

const transport = createTransport();

export const notificationService: NotificationService = {
  async send(to: string, subject: string, text: string): Promise<void> {
    try {
      await transport.sendMail({
        from: process.env.SMTP_FROM || 'noreply@groven.local',
        to,
        subject,
        text,
      });
    } catch (err) {
      logger.error(
        {
          err,
          to: '[REDACTED]',
        },
        'Failed to send notification',
      );
    }
  },
};
