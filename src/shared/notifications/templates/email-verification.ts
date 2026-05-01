export interface EmailVerificationPayload {
  otp: string;
  expiresInMinutes: number;
}

export function buildEmailVerificationEmail(payload: EmailVerificationPayload): {
  subject: string;
  text: string;
} {
  return {
    subject: 'Verify your email address',
    text: `
Your email verification code is: ${payload.otp}

This code will expire in ${payload.expiresInMinutes} minutes.

If you did not request this code, please ignore this email.

Do not share this code with anyone.
`.trim(),
  };
}
