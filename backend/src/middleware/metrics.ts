import { Router, Request, Response } from 'express';
import client from 'prom-client';

const router = Router();

const register = new client.Registry();

client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});
register.registerMetric(httpRequestDuration);

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});
register.registerMetric(httpRequestsTotal);

const activeConnections = new client.Gauge({
  name: 'http_active_connections',
  help: 'Number of active HTTP connections',
});
register.registerMetric(activeConnections);

const dbQueryDuration = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
});
register.registerMetric(dbQueryDuration);

const redisOperationsTotal = new client.Counter({
  name: 'redis_operations_total',
  help: 'Total number of Redis operations',
  labelNames: ['operation', 'status'],
});
register.registerMetric(redisOperationsTotal);

const queueJobsTotal = new client.Counter({
  name: 'queue_jobs_total',
  help: 'Total number of queue jobs processed',
  labelNames: ['queue', 'status'],
});
register.registerMetric(queueJobsTotal);

// Kafka consumer lag — set by kafka.service.ts lag monitor every 30s
export const kafkaConsumerLag = new client.Gauge({
  name: 'kafka_consumer_group_lag',
  help: 'Number of messages a Kafka consumer group is behind the latest offset',
  labelNames: ['group', 'topic', 'partition'],
});
register.registerMetric(kafkaConsumerLag);

export function trackHttpRequest(method: string, route: string, statusCode: number, durationMs: number) {
  httpRequestsTotal.inc({ method, route, status_code: statusCode });
  httpRequestDuration.observe({ method, route, status_code: statusCode }, durationMs / 1000);
}

export function trackDbQuery(operation: string, durationMs: number) {
  dbQueryDuration.observe({ operation }, durationMs / 1000);
}

export function trackRedisOperation(operation: string, status: string) {
  redisOperationsTotal.inc({ operation, status });
}

export function trackQueueJob(queue: string, status: string) {
  queueJobsTotal.inc({ queue, status });
}

export function incrementActiveConnections() {
  activeConnections.inc();
}

export function decrementActiveConnections() {
  activeConnections.dec();
}

router.get('/', async (_req: Request, res: Response) => {
  res.set('Content-Type', register.contentType);
  const metrics = await register.metrics();
  res.send(metrics);
});

export default router;
export { register };
