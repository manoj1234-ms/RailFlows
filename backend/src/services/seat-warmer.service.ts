import { Pool } from 'pg';
import { cache, CACHE_TTL } from './cache.service';
import logger from '../utils/logger';
import { createConsumer, TOPICS, isKafkaReady } from './kafka.service';

/** How often to re-warm the cache (ms). Default: 5 minutes (consistency sweep) */
const WARM_INTERVAL_MS = 5 * 60 * 1000;

/** How many top-demand trains to pre-warm on each cycle */
const TOP_N_TRAINS = 20;

interface TrainRow {
  train_number: string;
  from_station: string;
  to_station: string;
  departure_time: string;
  arrival_time: string;
  base_fare: number;
  name: string;
}

interface SeatAvailability {
  total: number;
  available: number;
  locked: number;
  booked: number;
  byClass: Record<string, { total: number; available: number }>;
}

async function fetchSeatAvailability(
  pool: Pool,
  trainNumber: string
): Promise<SeatAvailability> {
  const { rows } = await pool.query<{
    coach_class: string;
    status: string;
    cnt: string;
  }>(
    `SELECT coach_class, status, COUNT(*) AS cnt
     FROM seats
     WHERE train_number = $1
     GROUP BY coach_class, status`,
    [trainNumber]
  );

  const byClass: Record<string, { total: number; available: number }> = {};
  let total = 0;
  let available = 0;
  let locked = 0;
  let booked = 0;

  for (const row of rows) {
    const count = parseInt(row.cnt, 10);
    total += count;

    if (!byClass[row.coach_class]) {
      byClass[row.coach_class] = { total: 0, available: 0 };
    }
    byClass[row.coach_class].total += count;

    if (row.status === 'AVAILABLE') {
      available += count;
      byClass[row.coach_class].available += count;
    } else if (row.status === 'LOCKED') {
      locked += count;
    } else if (row.status === 'BOOKED') {
      booked += count;
    }
  }

  return { total, available, locked, booked, byClass };
}

async function fetchHighDemandTrains(pool: Pool): Promise<TrainRow[]> {
  /**
   * Heuristic: trains with most LOCKED or BOOKED seats in the past 24 hours
   * are likely experiencing high demand. Fall back to all trains if none qualify.
   */
  const { rows } = await pool.query<TrainRow>(
    `SELECT t.train_number, t.name, t.from_station, t.to_station,
            t.departure_time, t.arrival_time, t.base_fare
     FROM trains t
     JOIN (
       SELECT train_number, COUNT(*) AS demand
       FROM seats
       WHERE status IN ('LOCKED','BOOKED')
       GROUP BY train_number
       ORDER BY demand DESC
       LIMIT $1
     ) d ON t.train_number = d.train_number`,
    [TOP_N_TRAINS]
  );

  if (rows.length === 0) {
    // Cold start: warm all trains
    const fallback = await pool.query<TrainRow>(
      `SELECT train_number, name, from_station, to_station,
              departure_time, arrival_time, base_fare
       FROM trains
       LIMIT $1`,
      [TOP_N_TRAINS]
    );
    return fallback.rows;
  }

  return rows;
}

/**
 * Invalidate + immediately re-warm a single train's seat availability cache.
 * Called instantly by the Kafka seat.released consumer — no waiting for the poll cycle.
 */
async function invalidateAndRewarm(pool: Pool, trainNumber: string): Promise<void> {
  const availKey = `seat-availability:${trainNumber}`;
  await cache.invalidate(availKey);

  try {
    const availability = await fetchSeatAvailability(pool, trainNumber);
    await cache.set(availKey, availability, CACHE_TTL.SEAT_AVAILABILITY);
    logger.info({ msg: '[SeatWarmer] Instant re-warm after seat.released', trainNumber });
  } catch (err: any) {
    logger.warn({ msg: '[SeatWarmer] Instant re-warm failed', trainNumber, error: err.message });
  }
}

/**
 * Run one warming cycle: fetch top-demand trains + their seat availability
 * and push the results into CacheService under the same keys that the
 * train-search route would generate.
 */
async function runWarmingCycle(pool: Pool): Promise<void> {
  try {
    const trains = await fetchHighDemandTrains(pool);
    if (trains.length === 0) return;

    let warmed = 0;
    await Promise.all(
      trains.map(async (train) => {
        try {
          // Key used by train routes: `seat-availability:${train_number}`
          const availKey = `seat-availability:${train.train_number}`;
          const availability = await fetchSeatAvailability(pool, train.train_number);
          await cache.set(availKey, availability, CACHE_TTL.SEAT_AVAILABILITY);

          // Key used by train search: `train-details:${train_number}`
          const detailKey = `train-details:${train.train_number}`;
          await cache.set(detailKey, train, CACHE_TTL.TRAIN_DETAILS);

          warmed++;
        } catch (err: any) {
          logger.warn({
            msg: '[SeatWarmer] Failed to warm train',
            trainNumber: train.train_number,
            error: err.message,
          });
        }
      })
    );

    logger.info({
      msg: '[SeatWarmer] Warming cycle complete',
      trainCount: trains.length,
      warmedEntries: warmed * 2, // availability + details
    });
  } catch (err: any) {
    logger.error({ msg: '[SeatWarmer] Warming cycle failed', error: err.message });
  }
}

let _warmerId: ReturnType<typeof setInterval> | null = null;

/**
 * Start the seat pre-warm cache daemon.
 * Call once from index.ts after DB, Redis, and Kafka are ready.
 */
export function startSeatWarmer(pool: Pool): void {
  logger.info('[SeatWarmer] Starting seat pre-warm cache daemon...');

  // Warm immediately on startup (non-blocking)
  runWarmingCycle(pool).catch(() => {});

  // Periodic consistency sweep (catches any missed events)
  _warmerId = setInterval(() => {
    runWarmingCycle(pool).catch(() => {});
  }, WARM_INTERVAL_MS);

  logger.info(`[SeatWarmer] Cache warmer scheduled every ${WARM_INTERVAL_MS / 1000}s`);

  // ── Event-driven invalidation via Kafka ──────────────────────────────────
  // Subscribe to seat.released topic for instant cache invalidation.
  // Gracefully degrades to poll-only if Kafka is unavailable.
  if (isKafkaReady()) {
    createConsumer(
      'railflow-seat-cache',
      [TOPICS.SEAT_RELEASED],
      async (_topic, message) => {
        const trainNumber: string = message.trainNumber;
        if (!trainNumber) return;
        // Invalidate + re-warm immediately — no waiting for the 5-min poll
        await invalidateAndRewarm(pool, trainNumber);
      }
    ).then(() => {
      logger.info('[SeatWarmer] Kafka seat.released consumer registered — instant cache invalidation active');
    }).catch((err: any) => {
      logger.warn({ msg: '[SeatWarmer] Failed to register Kafka consumer — falling back to poll-only', error: err.message });
    });
  } else {
    logger.warn('[SeatWarmer] Kafka not ready — running in poll-only mode (5-min cache staleness window)');
  }
}

export function stopSeatWarmer(): void {
  if (_warmerId) {
    clearInterval(_warmerId);
    _warmerId = null;
    logger.info('[SeatWarmer] Seat pre-warm cache daemon stopped.');
  }
}
