import { Queue, Worker, type Processor } from 'bullmq';
import IORedis from 'ioredis';

import { env } from '@/shared/config/env';

let _connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (_connection) return _connection;
  if (!env.REDIS_URL) throw new Error('REDIS_URL is required when QUEUE_BACKEND=redis');
  _connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _connection;
}

export function createQueue(name: string): Queue {
  return new Queue(name, { connection: getRedisConnection() });
}

export function createWorker<T>(name: string, processor: Processor<T>): Worker<T> {
  return new Worker(name, processor, {
    connection: getRedisConnection(),
    concurrency: 5,
  });
}

export async function closeConnection(): Promise<void> {
  if (_connection) {
    await _connection.quit();
    _connection = null;
  }
}
