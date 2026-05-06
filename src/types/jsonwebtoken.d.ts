export {};

declare module 'jsonwebtoken' {
  interface JwtPayload {
    email?: string;
    userId?: string;
  }
}
