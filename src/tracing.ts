import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { FastifyOtelInstrumentation } from '@fastify/otel';
import { env } from './shared/config/env';

const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
console.log(endpoint);

const sdk = new NodeSDK({
  serviceName: env.SERVICE_NAME,
  traceExporter: endpoint ? new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }) : new ConsoleSpanExporter(),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false }, // too noisy
      '@opentelemetry/instrumentation-pg': { enabled: true },
    }),
    new FastifyOtelInstrumentation({ registerOnInitialization: true }),
  ],
});

sdk.start();

process.on('SIGTERM', () => sdk.shutdown());
process.on('SIGINT', () => sdk.shutdown());
