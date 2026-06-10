import { getDb } from '../config/db';
import { getRedis, isRedisReady } from '../config/redis';
import { addSeatExpiryJob } from './queue.service';
import logger from '../utils/logger';

const REDIS_LOCK_PREFIX = 'seatlock:';

export class SeatLockService {
  static async acquireSeatLock(
    trainNumber: string,
    coachLabel: string,
    seatNumber: number,
    userId: number
  ): Promise<boolean> {
    const db = await getDb();
    const expiresAt = new Date(Date.now() + 180 * 1000).toISOString();
    const now = new Date().toISOString();

    const lockKey = `${REDIS_LOCK_PREFIX}${trainNumber}:${coachLabel}:${seatNumber}`;

    if (isRedisReady()) {
      try {
        const redis = getRedis();
        const acquired = await redis.set(lockKey, userId, 'EX', 180, 'NX');
        if (!acquired) {
          const owner = await redis.get(lockKey);
          if (owner && Number(owner) !== userId) {
            const existingLock = await db.get(
              'SELECT status FROM seats WHERE train_number = ? AND coach_label = ? AND seat_number = ?',
              [trainNumber, coachLabel, seatNumber]
            );
            if (existingLock && existingLock.status === 'LOCKED') {
              return false;
            }
          }
        }
      } catch (err: any) {
        logger.warn({ msg: '[SeatLock] Redis lock failed, falling back to DB', error: err.message });
      }
    }

    const result = await db.run(
      `UPDATE seats
       SET status = 'LOCKED', locked_by = ?, lock_expires_at = ?
       WHERE train_number = ? AND coach_label = ? AND seat_number = ?
         AND (
           status = 'AVAILABLE'
           OR (status = 'LOCKED' AND datetime(lock_expires_at) < datetime(?))
         )`,
      [userId, expiresAt, trainNumber, coachLabel, seatNumber, now]
    );

    const acquired = (result.changes ?? 0) > 0;

    if (acquired && isRedisReady()) {
      await addSeatExpiryJob(trainNumber, coachLabel, seatNumber, userId, 180 * 1000);
    }

    return acquired;
  }

  static async releaseSeatLock(
    trainNumber: string,
    coachLabel: string,
    seatNumber: number,
    userId: number
  ): Promise<boolean> {
    const db = await getDb();

    const lockKey = `${REDIS_LOCK_PREFIX}${trainNumber}:${coachLabel}:${seatNumber}`;
    if (isRedisReady()) {
      try {
        const redis = getRedis();
        const owner = await redis.get(lockKey);
        if (owner && Number(owner) === userId) {
          await redis.del(lockKey);
        }
      } catch { }
    }

    const result = await db.run(
      `UPDATE seats
       SET status = 'AVAILABLE', locked_by = NULL, lock_expires_at = NULL
       WHERE train_number = ? AND coach_label = ? AND seat_number = ?
         AND status = 'LOCKED' AND locked_by = ?`,
      [trainNumber, coachLabel, seatNumber, userId]
    );

    return (result.changes ?? 0) > 0;
  }

  static async cleanupExpiredLocks(): Promise<number> {
    const db = await getDb();
    const now = new Date().toISOString();

    const result = await db.run(
      `UPDATE seats
       SET status = 'AVAILABLE', locked_by = NULL, lock_expires_at = NULL
       WHERE status = 'LOCKED' AND datetime(lock_expires_at) < datetime(?)`,
      [now]
    );

    if (isRedisReady()) {
      try {
        const redis = getRedis();
        const lockKeys = await redis.keys(`${REDIS_LOCK_PREFIX}*`);
        for (const key of lockKeys) {
          const seatKey = key.replace(REDIS_LOCK_PREFIX, '');
          const parts = seatKey.split(':');
          if (parts.length === 3) {
            const [tn, cl, sn] = parts;
            const seat = await db.get(
              'SELECT status FROM seats WHERE train_number = ? AND coach_label = ? AND seat_number = ?',
              [tn, cl, Number(sn)]
            );
            if (!seat || seat.status !== 'LOCKED') {
              await redis.del(key);
            }
          }
        }
      } catch { }
    }

    return result.changes ?? 0;
  }

  static async getLockStatus(
    trainNumber: string,
    coachLabel: string,
    seatNumber: number
  ): Promise<{ status: string; lockedBy: number | null; expiresAt: string | null; remainingSeconds: number }> {
    const db = await getDb();
    const seat = await db.get(
      'SELECT status, locked_by, lock_expires_at FROM seats WHERE train_number = ? AND coach_label = ? AND seat_number = ?',
      [trainNumber, coachLabel, seatNumber]
    );

    if (!seat) {
      throw new Error('Seat not found');
    }

    let remainingSeconds = 0;
    if (seat.status === 'LOCKED' && seat.lock_expires_at) {
      const expires = new Date(seat.lock_expires_at).getTime();
      const diff = expires - Date.now();
      remainingSeconds = Math.max(0, Math.floor(diff / 1000));
    }

    return {
      status: seat.status,
      lockedBy: seat.locked_by,
      expiresAt: seat.lock_expires_at,
      remainingSeconds,
    };
  }
}
