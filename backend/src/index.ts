import express, { Request, Response, NextFunction } from 'express';
import compression from 'compression';
import helmet from 'helmet';
import cluster from 'cluster';
import os from 'os';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import http from 'http';
import { initDb, closeDb, getPool } from './config/db';
import { initRedis, closeRedis, isRedisReady } from './config/redis';
import { initKafka, closeKafka, isKafkaReady } from './services/kafka.service';
import { swaggerDefinition } from './config/swagger';
import { corsHeaders, securityHeaders } from './middleware/securityHeaders';
import { SeatLockService } from './services/lock.service';
import { cache } from './services/cache.service';
import { startQueueWorkers, stopQueueWorkers } from './services/queue.service';
import { CircuitBreaker } from './services/pricing.service';
import { errorHandler } from './utils/AppError';
import { setCsrfToken, csrfProtection } from './middleware/csrf';
import { requestIdMiddleware } from './middleware/requestId';
import { generalRateLimiter, authRateLimiter, paymentRateLimiter } from './middleware/rateLimiter';
import { sanitizeInput } from './utils/sanitize';
import logger from './utils/logger';
import { trackHttpRequest, incrementActiveConnections, decrementActiveConnections } from './middleware/metrics';
import metricsRouter from './middleware/metrics';
import { setupLiveTracking, closeLiveTracking } from './services/live-tracking-ws.service';
import { runMigrations } from './migrations/index';
import { startSeatWarmer, stopSeatWarmer } from './services/seat-warmer.service';
import './config/otel'; // OTel SDK bootstrap — no-op unless OTEL_ENABLED=true
import { shutdownOtel } from './config/otel';
import { startPartitionMaintainer, stopPartitionMaintainer } from './services/partition-maintainer.service';
import { NotificationService } from './services/notification.service';


import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import trainRoutes from './routes/train.routes';
import bookingRoutes from './routes/booking.routes';
import queueRoutes from './routes/queue.routes';
import paymentRoutes from './routes/payment.routes';
import adminRoutes from './routes/admin.routes';
import notificationRoutes from './routes/notification.routes';
import stationRoutes from './routes/station.routes';
import scheduleRoutes from './routes/schedule.routes';
import platformRoutes from './routes/platform.routes';
import eventRoutes from './routes/event.routes';
import refundRoutes, { adminRefundRouter } from './routes/refund.routes';
import loyaltyRoutes from './routes/loyalty.routes';
import chatbotRoutes from './routes/chatbot.routes';
import webauthnRoutes from './routes/webauthn.routes';

dotenv.config();

const PORT = process.env.PORT || 5000;
const isClusterMode = process.env.CLUSTER_ENABLED === 'true';
const cpuCount = os.cpus().length;

function validateEnv(): void {
  const required = ['PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    logger.error({ msg: 'Missing required environment variables', vars: missing });
    process.exit(1);
  }
}

function sanitizeBody(body: any): any {
  if (!body || typeof body !== 'object') return body;
  const copy = { ...body };
  if (copy.password) copy.password = '[REDACTED_PASSWORD]';
  if (copy.mfaToken) copy.mfaToken = '[REDACTED_TOKEN]';
  if (copy.secret) copy.secret = '[REDACTED_SECRET]';
  if (copy.aadhaar) copy.aadhaar = 'XXXX-XXXX-XXXX';
  if (copy.cvv) copy.cvv = '[REDACTED_CVV]';
  if (copy.cardNumber) {
    const num = String(copy.cardNumber).replace(/\s/g, '');
    copy.cardNumber = num.length >= 8 ? `${num.substring(0, 4)}...${num.substring(num.length - 4)}` : 'XXXX-XXXX-XXXX';
  }
  if (copy.passengers && Array.isArray(copy.passengers)) {
    copy.passengers = copy.passengers.map((p: any) => ({ ...p, aadhaar: 'XXXX-XXXX-XXXX' }));
  }
  return copy;
}

export function createApp() {
  const app = express();

  app.use(requestIdMiddleware);
  app.use(compression());
  app.use(helmet());
  app.use(securityHeaders);
  app.use(corsHeaders);
  app.use(cookieParser());
  app.use(setCsrfToken);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.set('trust proxy', 1);

  app.use((req: Request, res: Response, next: NextFunction) => {
    incrementActiveConnections();
    const start = Date.now();
    res.on('finish', () => {
      const elapsed = Date.now() - start;
      decrementActiveConnections();
      trackHttpRequest(req.method, req.route?.path || req.originalUrl, res.statusCode, elapsed);
      logger.info({
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        elapsedMs: elapsed,
        ip: req.ip,
        body: sanitizeBody(req.body),
      });
    });
    next();
  });

  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.body && typeof req.body === 'object') {
      for (const key of Object.keys(req.body)) {
        if (typeof req.body[key] === 'string') {
          req.body[key] = sanitizeInput(req.body[key]);
        }
      }
    }
    next();
  });

  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDefinition));
  app.get('/api/docs.json', (_req: Request, res: Response) => res.json(swaggerDefinition));

  app.get('/health', async (_req: Request, res: Response) => {
    let dbStatus = 'disconnected';
    try {
      const pool = getPool();
      await pool.query('SELECT 1');
      dbStatus = 'connected';
    } catch { }
    res.json({
      status: 'healthy',
      pid: process.pid,
      worker: cluster.isWorker ? `worker-${cluster.worker?.id}` : 'master',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      database: dbStatus,
      redis: isRedisReady() ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/health/cache', (_req: Request, res: Response) => {
    res.json({ status: 'success', data: cache.getMetrics() });
  });

  app.get('/health/redis', (_req: Request, res: Response) => {
    res.json({ status: 'success', redis: isRedisReady() ? 'connected' : 'disconnected' });
  });

  app.get('/health/circuit-breaker', (_req: Request, res: Response) => {
    res.json({ status: 'success', data: CircuitBreaker.getMetrics() });
  });

  app.get('/', (_req: Request, res: Response) => {
    res.json({
      status: 'success',
      message: 'Welcome to the RailFlow high-scale ticket booking API',
      version: '2.1.0',
      cluster: isClusterMode ? `active (${cpuCount} workers)` : 'disabled',
      docs: '/api/docs',
    });
  });

  app.use('/metrics', metricsRouter);

  app.use(generalRateLimiter);

  app.use('/api/v1/auth', csrfProtection, authRateLimiter, authRoutes);
  app.use('/api/v1/users', userRoutes);
  app.use('/api/v1/trains', trainRoutes);
  app.use('/api/v1/bookings', csrfProtection, bookingRoutes);
  app.use('/api/v1/queue', queueRoutes);
  app.use('/api/v1/payments', csrfProtection, paymentRateLimiter, paymentRoutes);
  app.use('/api/v1/admin', csrfProtection, adminRoutes);
  app.use('/api/v1/notifications', notificationRoutes);
  app.use('/api/v1/stations', stationRoutes);
  app.use('/api/v1/schedule', scheduleRoutes);
  app.use('/api/v1/platform', platformRoutes);
  app.use('/api/v1/events', eventRoutes);
  app.use('/api/v1/loyalty', csrfProtection, loyaltyRoutes);
  app.use('/api/v1/chatbot', chatbotRoutes);
  app.use('/api/v1/webauthn', webauthnRoutes);
  app.use('/api/v1/admin/refunds', csrfProtection, adminRefundRouter);

  app.use('/api/auth', csrfProtection, authRateLimiter, authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/trains', trainRoutes);
  app.use('/api/bookings', csrfProtection, bookingRoutes);
  app.use('/api/queue', queueRoutes);
  app.use('/api/payments', csrfProtection, paymentRateLimiter, paymentRoutes);
  app.use('/api/admin', csrfProtection, adminRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/stations', stationRoutes);
  app.use('/api/schedule', scheduleRoutes);
  app.use('/api/platform', platformRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/loyalty', csrfProtection, loyaltyRoutes);
  app.use('/api/chatbot', chatbotRoutes);
  app.use('/api/webauthn', webauthnRoutes);
  app.use('/api/admin/refunds', csrfProtection, adminRefundRouter);

  app.use(errorHandler);

  return app;
}

async function startServer() {
  try {
    const pool = getPool();
    logger.info('Running database migrations...');
    await runMigrations(pool);
    logger.info('Database migrations complete.');

    await pool.query('DELETE FROM queue_tokens');
    logger.info('Cleared stale queue tokens.');

    await pool.query('ALTER TABLE queue_tokens ALTER COLUMN booking_window_expires_at TYPE TIMESTAMPTZ');
    await pool.query('ALTER TABLE queue_tokens ALTER COLUMN created_at TYPE TIMESTAMPTZ');
    logger.info('Migrated queue_tokens timestamps to TIMESTAMPTZ.');

    await pool.query('ALTER TABLE seats ALTER COLUMN lock_expires_at TYPE TIMESTAMPTZ');
    logger.info('Migrated seats.lock_expires_at to TIMESTAMPTZ.');

    await initDb();

    logger.info('Connecting to Redis...');
    await initRedis();
    if (isRedisReady()) {
      await startQueueWorkers();
    }

    logger.info('Connecting to Kafka...');
    await initKafka();
    if (isKafkaReady()) {
      logger.info('[Kafka] Producer ready — booking events will be published to Kafka topics');
    } else {
      logger.warn('[Kafka] Running without Kafka — set KAFKA_BROKERS env var to enable event streaming');
    }

    // Start seat pre-warm cache daemon (non-blocking)
    startSeatWarmer(getPool());

    // Start partition maintainer (creates next month/year partitions daily)
    startPartitionMaintainer(getPool());

    // Start Kafka consumer lag monitor
    if (isKafkaReady()) {
      const { startLagMonitor } = await import('./services/kafka.service');
      startLagMonitor(['railflow-notifications', 'railflow-seat-cache', 'railflow-loyalty']);
    }

    const app = createApp();
    const server = http.createServer(app);

    setupLiveTracking(server);

    server.listen(PORT, () => {
      const workerTag = cluster.isWorker ? `[Worker ${cluster.worker?.id}]` : '[Master]';
      logger.info(`${workerTag} [RailFlow] Server started on http://localhost:${PORT}`);
      logger.info(`Swagger docs at http://localhost:${PORT}/api/docs`);
      logger.info(`WebSocket live tracking at ws://localhost:${PORT}/ws/live-tracking`);
      logger.info(`Prometheus metrics at http://localhost:${PORT}/metrics`);

      setInterval(async () => {
        try {
          const cleaned = await SeatLockService.cleanupExpiredLocks();
          if (cleaned > 0) {
            logger.info(`[SeatLock Engine] Released ${cleaned} expired seat locks.`);
          }
        } catch (e: any) {
          logger.error({ msg: '[SeatLock Engine] Background cleanup failed', error: e.message });
        }
      }, 10 * 1000);

      setInterval(() => {
        const cleaned = cache.cleanupExpired();
        if (cleaned > 0) {
          logger.info(`[Cache Engine] Cleaned ${cleaned} expired cache entries.`);
        }
      }, 60 * 1000);

      setInterval(async () => {
        try {
          await NotificationService.processRetryQueue();
        } catch (e: any) {
          logger.error({ msg: '[Notification] Retry worker error', error: e.message });
        }
      }, 5 * 60 * 1000); // every 5 minutes
    });

    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Shutting down gracefully...`);
      await shutdownOtel();
      stopSeatWarmer();
      stopPartitionMaintainer();
      closeLiveTracking();


      server.close(async () => {
        await stopQueueWorkers();
        await closeKafka();
        await closeRedis();
        await closeDb();
        logger.info('Server shut down complete.');
        process.exit(0);
      });
      setTimeout(() => {
        logger.error('Forced shutdown after timeout.');
        process.exit(1);
      }, 15000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('uncaughtException', (err) => {
      logger.error({ msg: 'Uncaught exception', err });
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      logger.error({ msg: 'Unhandled rejection', reason });
    });

    return server;
  } catch (error) {
    logger.error({ msg: 'Fatal: Failed to start RailFlow API Server', error });
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  if (isClusterMode && cluster.isPrimary) {
    logger.info(`[Cluster Master] Forking ${cpuCount} workers...`);
    for (let i = 0; i < cpuCount; i++) {
      cluster.fork();
    }
    cluster.on('exit', (worker, code, signal) => {
      logger.warn(`[Cluster Master] Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
      cluster.fork();
    });
  } else {
    startServer();
  }
}
