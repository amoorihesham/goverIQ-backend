import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('groven_iq');

export const auditEmitTotal = meter.createCounter('audit_emitted', { description: 'Audit events emitted' });
