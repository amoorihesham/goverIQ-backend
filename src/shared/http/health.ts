import pino from 'pino';

import { success, failure } from '@/shared/errors/envelope';
import { AppError } from '@/shared/errors/http-error';
import { db } from '../database/client';

const logger = pino();

export async function checkHealth(): Promise<{ status: number; data: any }> {
  try {
    logger.debug('Checking health...');
    await db.execute('SELECT 1');
    const timestamp = new Date().toISOString();
    logger.debug('Health check passed');
    return {
      status: 200,
      data: success({ status: 'ok', timestamp }),
    };
  } catch (err) {
    logger.error({ err }, 'Health check failed');
    const degradedError = AppError.create('INTERNAL_ERROR', 'Service degraded');
    return {
      status: 503,
      data: failure(degradedError),
    };
  }
}
