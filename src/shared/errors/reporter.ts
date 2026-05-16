import { trace } from '@opentelemetry/api';
import * as Sentry from '@sentry/node';

export interface ErrorReportContext {
  reqId?: string;
  userId?: string;
  orgId?: string;
}

let enabled = false;

export function initErrorReporter(opts: { dsn?: string; environment?: string; release?: string }): void {
  if (!opts.dsn) return;

  Sentry.init({
    dsn: opts.dsn,
    environment: opts.environment,
    release: opts.release,
    // OTel is owned by tracing.ts; Sentry is errors-only here.
    skipOpenTelemetrySetup: true,
    tracesSampleRate: 0,
    defaultIntegrations: false,
    integrations: [Sentry.httpIntegration(), Sentry.requestDataIntegration()],
  });

  enabled = true;
}

export function reportError(err: unknown, context: ErrorReportContext = {}): void {
  if (!enabled) return;

  const traceId = trace.getActiveSpan()?.spanContext().traceId;

  Sentry.withScope((scope) => {
    if (context.reqId) scope.setTag('request.id', context.reqId);
    if (context.orgId) scope.setTag('org.id', context.orgId);
    if (context.userId) scope.setUser({ id: context.userId });
    if (traceId) scope.setTag('otel.trace_id', traceId);
    Sentry.captureException(err);
  });
}

export async function shutdownErrorReporter(timeoutMs = 2000): Promise<void> {
  if (!enabled) return;
  await Sentry.close(timeoutMs);
}
