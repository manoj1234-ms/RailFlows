import { Router, Response, NextFunction } from 'express';
import os from 'os';
import { getDb } from '../config/db';
import { authenticate, AuthenticatedRequest, requireRole, requireMfaForAdmins } from '../middleware/auth';
import { QueueService } from '../services/queue.service';
import { cache, CACHE_TTL } from '../services/cache.service';


const router = Router();

// Apply admin protection middleware stack
router.use(authenticate);
router.use(requireRole(['Admin', 'Super Admin']));
router.use(requireMfaForAdmins); // Require MFA to be completed for admin routes

// GET Dashboard Analytics (Cached)
router.get('/analytics', async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const cacheKey = 'admin:analytics';
  const cached = await cache.get<any>(cacheKey);
  if (cached) {
    res.status(200).json({ status: 'success', data: cached, source: 'cache' });
    return;
  }

  const db = await getDb();

  try {
    // Total Bookings count
    const totalBookingsResult = await db.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM bookings WHERE status = 'CONFIRMED'"
    );
    const totalBookings = totalBookingsResult?.count ?? 0;

    // Total Revenue
    const revenueResult = await db.get<{ sum: number }>(
      "SELECT SUM(price) as sum FROM bookings WHERE status = 'CONFIRMED'"
    );
    const totalRevenue = revenueResult?.sum ?? 0.0;

    // Route demand metrics
    const routeDemand = await db.all(
      `SELECT t.from_station || ' ➔ ' || t.to_station as route, COUNT(b.id) as bookingCount, SUM(b.price) as routeRevenue
       FROM bookings b
       JOIN trains t ON b.train_number = t.train_number
       WHERE b.status = 'CONFIRMED'
       GROUP BY t.train_number, t.from_station, t.to_station`

    );

    // Simulated peak hours occupancy metric
    const peakHours = [
      { hour: '08:00 - 10:00 (Tatkal Surge)', bookings: Math.floor(totalBookings * 0.45) },
      { hour: '12:00 - 14:00', bookings: Math.floor(totalBookings * 0.15) },
      { hour: '17:00 - 19:00', bookings: Math.floor(totalBookings * 0.25) },
      { hour: 'Others', bookings: Math.floor(totalBookings * 0.15) },
    ];

    const data = { totalBookings, totalRevenue, routeDemand, peakHours };
    await cache.set(cacheKey, data, CACHE_TTL.ADMIN_ANALYTICS);

    res.status(200).json({ status: 'success', data, source: 'database' });
  } catch (error) {
    next(error);
  }
});

// GET Virtual Queue health metrics
router.get('/queue-metrics', async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const queueMetrics = await QueueService.getQueueMetrics();
    res.status(200).json({
      status: 'success',
      data: queueMetrics,
    });
  } catch (error) {
    next(error);
  }
});

// GET Service Uptime, Latency and Resource Monitoring (Observability Grid - Cached)
router.get('/service-health', async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const cacheKey = 'admin:service-health';
  const cached = await cache.get<any>(cacheKey);
  if (cached) {
    res.status(200).json({ status: 'success', data: cached, source: 'cache' });
    return;
  }

  try {
    const memoryUsage = process.memoryUsage();
    
    // Server Host Metrics
    const hostMetrics = {
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
      cpuCount: os.cpus().length,
      freeMemoryBytes: os.freemem(),
      totalMemoryBytes: os.totalmem(),
      processMemory: {
        rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
      }
    };

    // Microservices health grid metrics (Simulated Observability telemetry)
    const microservices = [
      { name: 'Auth Service', status: 'HEALTHY', uptime: '99.99%', latencyMs: 14, cpuUsage: '2%', memoryBytes: '110 MB' },
      { name: 'Booking Service', status: 'HEALTHY', uptime: '99.98%', latencyMs: 35, cpuUsage: '4%', memoryBytes: '180 MB' },
      { name: 'Availability Service', status: 'HEALTHY', uptime: '99.99%', latencyMs: 8, cpuUsage: '1.2%', memoryBytes: '64 MB' },
      { name: 'Payment Service', status: 'HEALTHY', uptime: '100.00%', latencyMs: 110, cpuUsage: '0.8%', memoryBytes: '90 MB' },
      { name: 'Notification Service', status: 'HEALTHY', uptime: '99.95%', latencyMs: 120, cpuUsage: '1.5%', memoryBytes: '75 MB' },
      { name: 'Queue Manager', status: 'HEALTHY', uptime: '99.99%', latencyMs: 4, cpuUsage: '3.5%', memoryBytes: '120 MB' }
    ];

    const healthData = { host: hostMetrics, microservices };
    await cache.set(cacheKey, healthData, CACHE_TTL.ADMIN_SERVICE_HEALTH);

    res.status(200).json({ status: 'success', data: healthData, source: 'database' });
  } catch (error) {
    next(error);
  }
});

// GET Audit Logs (For Security Events review)
router.get('/audit-logs', async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const db = await getDb();
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;

  try {
    const countResult = await db.get<{ count: number }>('SELECT COUNT(*) as count FROM audit_logs');
    const total = countResult?.count ?? 0;

    const logs = await db.all(
      'SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );
    
    // Mask sensitive content in audit logs if any (Aadhaar or card info)
    const sanitizedLogs = logs.map(l => {
      let payload = l.payload;
      if (payload) {
        try {
          const parsed = JSON.parse(payload);
          if (parsed.aadhaar) {
            parsed.aadhaar = 'XXXX-XXXX-XXXX';
          }
          if (parsed.passengers) {
            parsed.passengers = parsed.passengers.map((p: any) => ({
              ...p,
              aadhaar: 'XXXX-XXXX-XXXX'
            }));
          }
          payload = JSON.stringify(parsed);
        } catch (e) {
          // Keep as string
        }
      }
      return { ...l, payload };
    });

    res.status(200).json({
      status: 'success',
      data: sanitizedLogs,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
