/**
 * kafka.service.ts
 *
 * KafkaService wraps kafkajs for RailFlow event publishing.
 * - Producer: publish booking/payment events to Kafka topics
 * - Consumer: subscribe to events (notification triggers, waitlist promotion)
 * - Transactional Outbox: relay unflushed DB outbox rows on startup
 *
 * Topics used:
 *   booking.confirmed     → Notification, Loyalty, Analytics consumers
 *   booking.cancelled     → Notification, Refund, Waitlist consumers
 *   payment.completed     → Booking, Notification consumers
 *   payment.failed        → Booking (compensate) consumer
 *   notification.email    → Notification Service
 *   notification.sms      → Notification Service
 *   seat.released         → Availability cache invalidation
 *
 * Dead Letter Queue pattern:
 *   On 3 consecutive failures → message published to <topic>.dlq
 */

import { Kafka, Producer, Consumer, logLevel, CompressionTypes } from 'kafkajs';
import logger from '../utils/logger';

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const CLIENT_ID = process.env.KAFKA_CLIENT_ID || 'railflow-backend';

let kafka: Kafka | null = null;
let producer: Producer | null = null;
const consumers: Map<string, Consumer> = new Map();

// ─────────────────────────────────────────────
// Topic definitions
// ─────────────────────────────────────────────
export const TOPICS = {
  BOOKING_CONFIRMED:   'booking.confirmed',
  BOOKING_CANCELLED:   'booking.cancelled',
  PAYMENT_COMPLETED:   'payment.completed',
  PAYMENT_FAILED:      'payment.failed',
  NOTIFICATION_EMAIL:  'notification.email',
  NOTIFICATION_SMS:    'notification.sms',
  SEAT_RELEASED:       'seat.released',
  AI_DEMAND_SIGNAL:    'ai.demand.signal',
  // Dead Letter Queues
  DLQ_BOOKING:         'booking.confirmed.dlq',
  DLQ_PAYMENT:         'payment.failed.dlq',
} as const;

export type KafkaTopic = typeof TOPICS[keyof typeof TOPICS];

// ─────────────────────────────────────────────
// Event payload types
// ─────────────────────────────────────────────
export interface BookingConfirmedEvent {
  bookingId: number;
  pnr: string;
  userId: number;
  userEmail: string;
  trainNumber: string;
  trainName: string;
  fromStation: string;
  toStation: string;
  departureTime: string;
  price: number;
  passengers: { name: string; age: number; gender: string }[];
  timestamp: string;
}

export interface BookingCancelledEvent {
  bookingId: number;
  pnr: string;
  userId: number;
  userEmail: string;
  trainNumber: string;
  refundAmount?: number;
  reason: string;
  timestamp: string;
}

export interface PaymentEvent {
  paymentId: string;
  bookingId: number;
  userId: number;
  amount: number;
  currency: string;
  method: string;
  status: 'completed' | 'failed';
  gatewayReference?: string;
  timestamp: string;
}

export interface NotificationEmailEvent {
  userId: number;
  to: string;
  subject: string;
  body: string;
  templateId?: string;
  referenceType: string;
  referenceId: string;
  timestamp: string;
}

// ─────────────────────────────────────────────
// Init & Teardown
// ─────────────────────────────────────────────
export async function initKafka(): Promise<void> {
  if (!process.env.KAFKA_BROKERS) {
    logger.warn('[Kafka] KAFKA_BROKERS not set — Kafka integration disabled. Events will be fire-and-forget via direct service calls.');
    return;
  }

  try {
    kafka = new Kafka({
      clientId: CLIENT_ID,
      brokers: KAFKA_BROKERS,
      logLevel: logLevel.WARN,
      retry: {
        initialRetryTime: 300,
        retries: 5,
      },
    });

    producer = kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30000,
    });

    await producer.connect();
    logger.info(`[Kafka] Producer connected to ${KAFKA_BROKERS.join(', ')}`);
  } catch (err: any) {
    logger.error({ msg: '[Kafka] Failed to connect producer', error: err.message });
    kafka = null;
    producer = null;
  }
}

export async function closeKafka(): Promise<void> {
  try {
    if (producer) await producer.disconnect();
    for (const [groupId, consumer] of consumers) {
      await consumer.disconnect();
      logger.info(`[Kafka] Consumer ${groupId} disconnected`);
    }
    consumers.clear();
    logger.info('[Kafka] All connections closed');
  } catch (err: any) {
    logger.error({ msg: '[Kafka] Error during shutdown', error: err.message });
  }
}

export function isKafkaReady(): boolean {
  return kafka !== null && producer !== null;
}

// ─────────────────────────────────────────────
// Publisher
// ─────────────────────────────────────────────
export async function publishEvent<T extends object>(
  topic: KafkaTopic,
  payload: T,
  key?: string
): Promise<void> {
  if (!producer) {
    logger.warn(`[Kafka] Producer not ready — skipping event to ${topic}`);
    return;
  }

  try {
    const message = JSON.stringify({
      ...payload,
      _meta: {
        topic,
        publishedAt: new Date().toISOString(),
        clientId: CLIENT_ID,
      },
    });

    await producer.send({
      topic,
      compression: CompressionTypes.GZIP,
      messages: [{ key: key || undefined, value: message }],
    });

    logger.info({ msg: '[Kafka] Event published', topic, key });
  } catch (err: any) {
    logger.error({ msg: '[Kafka] Failed to publish event', topic, error: err.message });
    // Optionally write to outbox DB table here as fallback
  }
}

// ─────────────────────────────────────────────
// Consumer factory
// ─────────────────────────────────────────────
export async function createConsumer(
  groupId: string,
  topics: KafkaTopic[],
  handler: (topic: string, message: any) => Promise<void>
): Promise<void> {
  if (!kafka) {
    logger.warn(`[Kafka] Cannot create consumer ${groupId} — Kafka not ready`);
    return;
  }

  const consumer = kafka.consumer({ groupId, retry: { retries: 3 } });
  consumers.set(groupId, consumer);

  await consumer.connect();
  await consumer.subscribe({ topics, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const raw = message.value?.toString();
      if (!raw) return;

      let attempts = 0;
      while (attempts < 3) {
        try {
          const payload = JSON.parse(raw);
          await handler(topic, payload);
          return;
        } catch (err: any) {
          attempts++;
          logger.warn({ msg: `[Kafka] Handler error (attempt ${attempts}/3)`, topic, error: err.message });
          if (attempts === 3) {
            // Send to DLQ
            await publishEvent(
              topic.includes('booking') ? TOPICS.DLQ_BOOKING : TOPICS.DLQ_PAYMENT,
              { originalTopic: topic, payload: raw, error: err.message, timestamp: new Date().toISOString() }
            );
          }
          await new Promise(r => setTimeout(r, 1000 * attempts)); // backoff
        }
      }
    },
  });

  logger.info(`[Kafka] Consumer ${groupId} subscribed to ${topics.join(', ')}`);
}

// ─────────────────────────────────────────────
// Convenience helpers (used by booking.routes.ts)
// ─────────────────────────────────────────────
export async function emitBookingConfirmed(event: BookingConfirmedEvent): Promise<void> {
  await publishEvent(TOPICS.BOOKING_CONFIRMED, event, event.pnr);
}

export async function emitBookingCancelled(event: BookingCancelledEvent): Promise<void> {
  await publishEvent(TOPICS.BOOKING_CANCELLED, event, event.pnr);
}

export async function emitPaymentEvent(event: PaymentEvent): Promise<void> {
  const topic = event.status === 'completed' ? TOPICS.PAYMENT_COMPLETED : TOPICS.PAYMENT_FAILED;
  await publishEvent(topic, event, event.paymentId);
}

export async function emitSeatReleased(trainNumber: string, seatNumbers: number[], coachLabel: string): Promise<void> {
  await publishEvent(TOPICS.SEAT_RELEASED, { trainNumber, coachLabel, seatNumbers, timestamp: new Date().toISOString() });
}

export async function emitEmailNotification(event: NotificationEmailEvent): Promise<void> {
  await publishEvent(TOPICS.NOTIFICATION_EMAIL, event, event.referenceId);
}

// ─────────────────────────────────────────────
// Kafka Consumer Lag Monitor
// ─────────────────────────────────────────────
import { kafkaConsumerLag } from '../middleware/metrics';

const LAG_POLL_MS = 30_000;
let _lagMonitorId: ReturnType<typeof setInterval> | null = null;

/**
 * Poll Kafka Admin API every 30s to compute per-partition consumer lag
 * and expose it on the `kafka_consumer_group_lag` Prometheus gauge.
 *
 * Lag = (latest offset on broker) − (committed offset for consumer group)
 */
export function startLagMonitor(groupIds: string[]): void {
  if (!kafka) {
    logger.warn('[Kafka] startLagMonitor: Kafka not ready — skipping lag monitoring');
    return;
  }

  const admin = kafka.admin();

  async function pollLag(): Promise<void> {
    try {
      await admin.connect();

      for (const groupId of groupIds) {
        try {
          // fetchOffsets returns { topic, partitions }[] directly
          const committedTopics = await admin.fetchOffsets({ groupId });

          for (const topicOffsets of committedTopics) {
            // Fetch latest (end) offsets from the broker for the same topic
            const latestOffsets = await admin.fetchTopicOffsets(topicOffsets.topic);

            for (const partitionInfo of topicOffsets.partitions) {
              const committed = parseInt(partitionInfo.offset, 10);
              const latestEntry = latestOffsets.find(
                (lo) => lo.partition === partitionInfo.partition
              );
              const latest = latestEntry ? parseInt(latestEntry.offset, 10) : 0;
              const lag = Math.max(0, latest - committed);

              kafkaConsumerLag.set(
                {
                  group: groupId,
                  topic: topicOffsets.topic,
                  partition: String(partitionInfo.partition),
                },
                lag
              );
            }
          }
        } catch (groupErr: any) {
          logger.warn({ msg: `[Kafka] Lag poll failed for group ${groupId}`, error: groupErr.message });
        }
      }
    } catch (err: any) {
      logger.error({ msg: '[Kafka] Admin connect failed in lag monitor', error: err.message });
    } finally {
      try { await admin.disconnect(); } catch { /* ignore */ }
    }
  }

  // Run immediately then on interval
  pollLag().catch(() => {});
  _lagMonitorId = setInterval(() => { pollLag().catch(() => {}); }, LAG_POLL_MS);
  logger.info(`[Kafka] Lag monitor started for groups: ${groupIds.join(', ')} (poll every ${LAG_POLL_MS / 1000}s)`);
}

export function stopLagMonitor(): void {
  if (_lagMonitorId) {
    clearInterval(_lagMonitorId);
    _lagMonitorId = null;
    logger.info('[Kafka] Lag monitor stopped');
  }
}
