import crypto from 'crypto';
import { Queue, Worker, Job } from 'bullmq';
import { getDb } from '../config/db';
import { getRedis, getRedisVersion, isBullMQCompatible, isRedisReady } from '../config/redis';
import logger from '../utils/logger';

export interface QueueTokenInfo {
  token: string;
  userId: number;
  originalPosition: number;
  currentPosition: number;
  estimatedWaitSeconds: number;
  bookingWindowExpiresAt: string | null;
  createdAt: string;
}

export const queueBanRegistry = new Map<number, number>();

let bookingQueue: Queue | null = null;
let notificationQueue: Queue | null = null;
let seatExpiryQueue: Queue | null = null;

export function getBookingQueue(): Queue | null {
  if (!bookingQueue && isBullMQCompatible()) {
    try {
      bookingQueue = new Queue('booking', { connection: getRedis() as any });
    } catch (e: any) {
      logger.warn('[Queue] Failed to create booking queue: ' + e.message);
    }
  }
  return bookingQueue;
}

export function getNotificationQueue(): Queue | null {
  if (!notificationQueue && isBullMQCompatible()) {
    try {
      notificationQueue = new Queue('notification', { connection: getRedis() as any });
    } catch (e: any) {
      logger.warn('[Queue] Failed to create notification queue: ' + e.message);
    }
  }
  return notificationQueue;
}

export function getSeatExpiryQueue(): Queue | null {
  if (!seatExpiryQueue && isBullMQCompatible()) {
    try {
      seatExpiryQueue = new Queue('seat-expiry', { connection: getRedis() as any });
    } catch (e: any) {
      logger.warn('[Queue] Failed to create seat expiry queue: ' + e.message);
    }
  }
  return seatExpiryQueue;
}

export async function startQueueWorkers(): Promise<void> {
  if (!isBullMQCompatible()) {
    logger.warn('[Queue] BullMQ requires Redis ≥ 5.0 (current: ' + (await getRedisVersion() || 'unknown') + '). Queue workers not started.');
    return;
  }

  const connection = getRedis() as any;

  new Worker('booking', async (job: Job) => {
    const { userId, trainNumber, coachLabel, seatNumber } = job.data;
    logger.info(`[Queue] Processing booking job ${job.id} for user ${userId} seat ${trainNumber}/${coachLabel}/${seatNumber}`);
    const db = await getDb();
    await db.run(
      `UPDATE seats SET status = 'BOOKED', locked_by = NULL, lock_expires_at = NULL
       WHERE train_number = ? AND coach_label = ? AND seat_number = ? AND status = 'LOCKED' AND locked_by = ?`,
      [trainNumber, coachLabel, seatNumber, userId]
    );
  }, { connection, concurrency: 5 });

  new Worker('notification', async (job: Job) => {
    const { userId, type, channel, subject, body } = job.data;
    logger.info(`[Queue] Processing notification job ${job.id} for user ${userId} via ${channel}`);
    const db = await getDb();
    await db.run(
      `INSERT INTO notifications (user_id, type, channel, subject, body, status)
       VALUES (?, ?, ?, ?, ?, 'SENT')`,
      [userId, type, channel, subject, body]
    );
  }, { connection, concurrency: 10 });

  new Worker('seat-expiry', async (job: Job) => {
    const { trainNumber, coachLabel, seatNumber, userId } = job.data;
    logger.info(`[Queue] Processing seat expiry for ${trainNumber}/${coachLabel}/${seatNumber}`);
    const db = await getDb();
    await db.run(
      `UPDATE seats SET status = 'AVAILABLE', locked_by = NULL, lock_expires_at = NULL
       WHERE train_number = ? AND coach_label = ? AND seat_number = ?
       AND status = 'LOCKED' AND locked_by = ?`,
      [trainNumber, coachLabel, seatNumber, userId]
    );
  }, { connection, concurrency: 5 });

  logger.info('[Queue] BullMQ workers started successfully');
}

export async function stopQueueWorkers(): Promise<void> {
  if (bookingQueue) { await bookingQueue.close(); bookingQueue = null; }
  if (notificationQueue) { await notificationQueue.close(); notificationQueue = null; }
  if (seatExpiryQueue) { await seatExpiryQueue.close(); seatExpiryQueue = null; }
}

export async function addBookingJob(userId: number, trainNumber: string, coachLabel: string, seatNumber: number, delayMs: number = 0): Promise<void> {
  const q = getBookingQueue();
  if (q) {
    await q.add('confirm-booking', { userId, trainNumber, coachLabel, seatNumber }, { delay: delayMs });
  }
}

export async function addNotificationJob(userId: number, type: string, channel: string, subject: string, body: string): Promise<void> {
  const q = getNotificationQueue();
  if (q) {
    await q.add('send-notification', { userId, type, channel, subject, body });
  }
}

export async function addSeatExpiryJob(trainNumber: string, coachLabel: string, seatNumber: number, userId: number, delayMs: number): Promise<void> {
  const q = getSeatExpiryQueue();
  if (q) {
    await q.add('release-seat', { trainNumber, coachLabel, seatNumber, userId }, { delay: delayMs });
  }
}

export class QueueService {
  static generateTokenHash(userId: number, ip: string, deviceFingerprint: string): string {
    return crypto
      .createHash('sha256')
      .update(`${userId}-${ip}-${deviceFingerprint}`)
      .digest('hex');
  }

  static async getOrCreateQueueToken(
    userId: number,
    ip: string,
    deviceFingerprint: string
  ): Promise<QueueTokenInfo> {
    const db = await getDb();

    const banExpires = queueBanRegistry.get(userId);
    if (banExpires && banExpires > Date.now()) {
      const remainingMin = Math.ceil((banExpires - Date.now()) / (60 * 1000));
      throw new Error(`Account suspended for queue manipulation. Retry in ${remainingMin} minutes.`);
    }

    const token = this.generateTokenHash(userId, ip, deviceFingerprint);

    const existing = await db.get(
      'SELECT * FROM queue_tokens WHERE token = ?',
      [token]
    );

    if (existing) {
      return this.processTokenState(existing);
    }

    const seqResult = await db.get<{ seq: string | number }>(
      "SELECT nextval('queue_position_seq') as seq"
    );
    const originalPosition = Number(seqResult?.seq ?? 1);

    const initWait = originalPosition * 300;
    await db.run(
      `INSERT INTO queue_tokens (token, user_id, queue_position, estimated_wait_seconds, booking_window_expires_at)
       VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT (token) DO NOTHING`,
      [token, userId, originalPosition, initWait]
    );

    const createdToken = await db.get(
      'SELECT * FROM queue_tokens WHERE token = ?',
      [token]
    );

    if (!createdToken) {
      throw new Error('Failed to create queue token');
    }

    return this.processTokenState(createdToken);
  }

  private static async processTokenState(tokenRow: any): Promise<QueueTokenInfo> {
    const db = await getDb();

    const originalPosition = tokenRow.queue_position;
    const nowIso = new Date().toISOString();

    // Current position = number of people ahead still in queue (with active or waiting tokens)
    const aheadActive = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM queue_tokens
       WHERE queue_position < ? AND token != ?
       AND (booking_window_expires_at IS NULL OR booking_window_expires_at > ?)`,
      [originalPosition, tokenRow.token, nowIso]
    );
    const currentPosition = Number(aheadActive?.count ?? 0);

    // Has an active window — check expiry
    if (currentPosition === 0 && tokenRow.booking_window_expires_at) {
      const expiresMs = new Date(tokenRow.booking_window_expires_at).getTime();
      if (Date.now() > expiresMs) {
        await db.run('DELETE FROM queue_tokens WHERE token = ?', [tokenRow.token]);
        throw new Error('Your booking queue window has expired. Please re-queue.');
      }
      return {
        token: tokenRow.token,
        userId: tokenRow.user_id,
        originalPosition,
        currentPosition: 0,
        estimatedWaitSeconds: 0,
        bookingWindowExpiresAt: tokenRow.booking_window_expires_at,
        createdAt: tokenRow.created_at,
      };
    }

    // At front of queue — grant 5 min booking window
    if (currentPosition === 0 && !tokenRow.booking_window_expires_at) {
      let allowGrant = true;
      if (isRedisReady()) {
        try {
          const redis = getRedis();
          const secondKey = `queue:grants:${Math.floor(Date.now() / 1000)}`;
          const currentGrants = await redis.incr(secondKey);
          if (currentGrants === 1) {
            await redis.expire(secondKey, 5);
          }
          // Max 10 window grants per second to prevent database surges
          if (currentGrants > 10) {
            allowGrant = false;
          }
        } catch (err) {
          // Fallback to normal behavior on Redis error
        }
      }

      if (allowGrant) {
        const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        await db.run(
          'UPDATE queue_tokens SET queue_position = ?, estimated_wait_seconds = 0, booking_window_expires_at = ? WHERE token = ?',
          [originalPosition, expires, tokenRow.token]
        );
        return {
          token: tokenRow.token,
          userId: tokenRow.user_id,
          originalPosition,
          currentPosition: 0,
          estimatedWaitSeconds: 0,
          bookingWindowExpiresAt: expires,
          createdAt: tokenRow.created_at,
        };
      } else {
        // Stagger: Force user to wait. Treat them as position 1 with 1s wait estimate
        return {
          token: tokenRow.token,
          userId: tokenRow.user_id,
          originalPosition,
          currentPosition: 1,
          estimatedWaitSeconds: 1,
          bookingWindowExpiresAt: null,
          createdAt: tokenRow.created_at,
        };
      }
    }

    // Still waiting — estimate wait time
    const estimatedWaitSeconds = currentPosition * 300;
    await db.run(
      'UPDATE queue_tokens SET queue_position = ?, estimated_wait_seconds = ? WHERE token = ?',
      [originalPosition, estimatedWaitSeconds, tokenRow.token]
    );

    return {
      token: tokenRow.token,
      userId: tokenRow.user_id,
      originalPosition,
      currentPosition,
      estimatedWaitSeconds,
      bookingWindowExpiresAt: null,
      createdAt: tokenRow.created_at,
    };
  }

  static async verifyBookingAccess(userId: number): Promise<boolean> {
    const db = await getDb();

    const user = await db.get('SELECT role FROM users WHERE id = ?', [userId]);
    if (user && ['Admin', 'Super Admin'].includes(user.role)) {
      return true;
    }

    const tokens = await db.all('SELECT * FROM queue_tokens WHERE user_id = ?', [userId]);
    for (const t of tokens) {
      try {
        const processed = await this.processTokenState(t);
        if (processed.currentPosition === 0 && processed.bookingWindowExpiresAt) {
          const expiresMs = new Date(processed.bookingWindowExpiresAt).getTime();
          if (expiresMs > Date.now()) {
            return true;
          }
        }
      } catch (e) {
        // Log expiration
      }
    }

    return false;
  }

  static async banUserForTampering(userId: number): Promise<void> {
    const db = await getDb();
    const expiry = Date.now() + 30 * 60 * 1000;
    queueBanRegistry.set(userId, expiry);

    await db.run('DELETE FROM queue_tokens WHERE user_id = ?', [userId]);

    await db.run(
      "INSERT INTO audit_logs (actor, action, ip, payload) VALUES (?, 'SUSPEND_QUEUE_TAMPERING', 'SYSTEM', ?)",
      [`User #${userId}`, JSON.stringify({ reason: 'Queue header manipulation detected', durationMinutes: 30 })]
    );
  }

  static async getQueueMetrics(): Promise<{ activeQueueLength: number; averageWaitSeconds: number; throughput: number }> {
    const db = await getDb();

    const activeCount = await db.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM queue_tokens WHERE booking_window_expires_at IS NULL"
    );

    const insideWindow = await db.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM queue_tokens WHERE booking_window_expires_at IS NOT NULL AND datetime(booking_window_expires_at) > datetime('now')"
    );

    const len = Number(activeCount?.count ?? 0);

    return {
      activeQueueLength: len,
      averageWaitSeconds: len * 300,
      throughput: (insideWindow?.count ?? 0) * 12,
    };
  }
}
