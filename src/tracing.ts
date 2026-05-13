import { env } from './shared/config/env';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { FastifyOtelInstrumentation } from '@fastify/otel';
import { logger } from '@sentry/node';
import { initErrorReporter } from './shared/errors/reporter';

initErrorReporter({
  dsn: env.SENTRY_DSN,
  environment: env.SENTRY_ENVIRONMENT,
  release: env.SENTRY_RELEASE,
});

const traceExporter = new OTLPTraceExporter({
  url: env.OTEL_EXPORTER_OTLP_ENDPOINT,
});

const metricsExporter = new PrometheusExporter({ port: 9464 });

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: env.OTEL_SERVICE_VERSION,
  }),
  traceExporter,
  metricReader: metricsExporter,
  instrumentations: [getNodeAutoInstrumentations(), new FastifyOtelInstrumentation({ registerOnInitialization: true })],
});

sdk.start();
logger.info('OpenTelemetry SDK initialized');

process.on('SIGTERM', () => {
  sdk
    .shutdown()
    .then(() => console.log('OTel SDK shut down'))
    .finally(() => process.exit(0));
});
