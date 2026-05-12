import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { FastifyOtelInstrumentation } from '@fastify/otel';

const traceExporter = new OTLPTraceExporter({
  url: process.env.OTEL_TRACES_ENDPOINT ?? 'http://localhost:4318/v1/traces',
});

const metricsExporter = new PrometheusExporter({ port: 9464 });

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'groven_iq',
    [ATTR_SERVICE_VERSION]: '1.0.0',
  }),
  traceExporter,
  metricReader: metricsExporter,
  instrumentations: [getNodeAutoInstrumentations(), new FastifyOtelInstrumentation({ registerOnInitialization: true })],
});

sdk.start();
console.log('OpenTelemetry SDK started');

process.on('SIGTERM', () => {
  sdk
    .shutdown()
    .then(() => console.log('OTel SDK shut down'))
    .finally(() => process.exit(0));
});
