import { getDb } from '../config/db';
import logger from '../utils/logger';

export interface NotificationPayload {
  userId: number;
  type: 'EMAIL' | 'SMS' | 'PUSH';
  channel: string;
  subject?: string;
  body: string;
  referenceType?: string;
  referenceId?: string;
}

/** Retry schedule: [5 min, 30 min, 2 h] */
const RETRY_DELAYS_MS = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
const MAX_RETRIES = RETRY_DELAYS_MS.length;

export class NotificationService {
  /**
   * Attempt to send a notification and persist the result.
   * On failure, schedules a retry with exponential backoff (up to MAX_RETRIES).
   * Returns the DB row id of the created notification record.
   */
  static async send(payload: NotificationPayload): Promise<boolean> {
    const db = await getDb();

    try {
      // Check user preferences before sending
      const prefs = await db.get(
        'SELECT * FROM notification_preferences WHERE user_id = ?',
        [payload.userId]
      );

      const typeKey = `${payload.type.toLowerCase()}_enabled` as keyof typeof prefs;
      if (prefs && prefs[typeKey] === 0) {
        logger.info({ msg: '[Notification] Skipped (user preference)', type: payload.type, userId: payload.userId });
        return false;
      }

      const channelMap: Record<string, string> = {
        EMAIL: `${payload.channel || 'email@example.com'}`,
        SMS: `${payload.channel || '+91XXXXXXXXXX'}`,
        PUSH: `Device::${payload.channel || 'default-device'}`,
      };
      const destination = channelMap[payload.type] || payload.channel;

      // Simulate delivery (replace with real provider SDK call)
      await new Promise((resolve) => setTimeout(resolve, 200));

      logger.info({ msg: '[Notification] Sent', type: payload.type, destination, subject: payload.subject });

      await db.run(
        `INSERT INTO notifications
           (user_id, type, channel, subject, body, status, reference_type, reference_id, retry_count)
         VALUES (?, ?, ?, ?, ?, 'SENT', ?, ?, 0)`,
        [payload.userId, payload.type, destination, payload.subject || null,
          payload.body, payload.referenceType || null, payload.referenceId || null]
      );

      return true;
    } catch (error: any) {
      logger.error({ msg: '[Notification] Delivery failed', type: payload.type, error: error.message });

      // Schedule first retry in RETRY_DELAYS_MS[0]
      const nextRetryAt = new Date(Date.now() + RETRY_DELAYS_MS[0]).toISOString();

      await db.run(
        `INSERT INTO notifications
           (user_id, type, channel, subject, body, status, reference_type, reference_id, retry_count, next_retry_at)
         VALUES (?, ?, ?, ?, ?, 'FAILED', ?, ?, 0, ?)`,
        [payload.userId, payload.type, payload.channel, payload.subject || null,
          payload.body, payload.referenceType || null, payload.referenceId || null, nextRetryAt]
      );

      return false;
    }
  }

  /**
   * Retry worker — call every 5 minutes from index.ts.
   * Picks up FAILED notifications whose next_retry_at has elapsed and retries them.
   * On success: marks SENT, clears next_retry_at.
   * On final failure (retry_count >= MAX_RETRIES): marks FAILED permanently, nulls next_retry_at.
   */
  static async processRetryQueue(): Promise<void> {
    const db = await getDb();

    const due = await db.all(
      `SELECT * FROM notifications
       WHERE status = 'FAILED'
         AND retry_count < ?
         AND next_retry_at IS NOT NULL
         AND next_retry_at <= datetime('now')
       LIMIT 50`,
      [MAX_RETRIES]
    );

    if (due.length === 0) return;

    logger.info({ msg: '[Notification] Retry queue processing', count: due.length });

    for (const notification of due) {
      try {
        // Re-attempt delivery
        await new Promise((resolve) => setTimeout(resolve, 200));

        await db.run(
          `UPDATE notifications
           SET status = 'SENT', retry_count = retry_count + 1, next_retry_at = NULL
           WHERE id = ?`,
          [notification.id]
        );

        logger.info({ msg: '[Notification] Retry succeeded', id: notification.id, attempt: notification.retry_count + 1 });
      } catch (err: any) {
        const nextCount = notification.retry_count + 1;
        const isExhausted = nextCount >= MAX_RETRIES;

        if (isExhausted) {
          // All retries exhausted — mark permanently failed
          await db.run(
            `UPDATE notifications
             SET retry_count = ?, next_retry_at = NULL
             WHERE id = ?`,
            [nextCount, notification.id]
          );
          logger.error({ msg: '[Notification] All retries exhausted', id: notification.id, type: notification.type });
        } else {
          // Schedule next retry with backoff
          const nextRetryAt = new Date(Date.now() + RETRY_DELAYS_MS[nextCount]).toISOString();
          await db.run(
            `UPDATE notifications
             SET retry_count = ?, next_retry_at = ?
             WHERE id = ?`,
            [nextCount, nextRetryAt, notification.id]
          );
          logger.warn({ msg: '[Notification] Retry failed, rescheduled', id: notification.id, nextRetryAt, attempt: nextCount });
        }
      }
    }
  }

  /**
   * Mark a notification as delivered — called by provider webhook.
   * Sets delivered_at timestamp and status to READ.
   */
  static async markDelivered(notificationId: number): Promise<void> {
    const db = await getDb();
    await db.run(
      `UPDATE notifications
       SET status = 'READ', delivered_at = datetime('now'), next_retry_at = NULL
       WHERE id = ?`,
      [notificationId]
    );
    logger.info({ msg: '[Notification] Delivery confirmed', id: notificationId });
  }

  /**
   * Convenience: send booking confirmation email + SMS.
   */
  static async sendBookingConfirmation(
    userId: number,
    email: string,
    phone: string,
    pnr: string,
    trainName: string,
    seatDetails: string
  ): Promise<void> {
    await Promise.all([
      this.send({
        userId,
        type: 'EMAIL',
        channel: email,
        subject: `Booking Confirmed - PNR: ${pnr}`,
        body: `Your booking on ${trainName} (PNR: ${pnr}) is confirmed. Seats: ${seatDetails}. Thank you for choosing RailFlow!`,
        referenceType: 'BOOKING',
        referenceId: pnr,
      }),
      this.send({
        userId,
        type: 'SMS',
        channel: phone,
        body: `RailFlow: Booking CONFIRMED. PNR: ${pnr}. Train: ${trainName}. Seats: ${seatDetails}. Download ticket: https://railflow.app/ticket/${pnr}`,
        referenceType: 'BOOKING',
        referenceId: pnr,
      }),
    ]);
  }

  /**
   * Convenience: send payment receipt.
   */
  static async sendPaymentReceipt(
    userId: number,
    email: string,
    amount: number,
    transactionId: string,
    status: string
  ): Promise<void> {
    await this.send({
      userId,
      type: 'EMAIL',
      channel: email,
      subject: `Payment ${status} - ${transactionId}`,
      body: `Your payment of ₹${amount} (Txn: ${transactionId}) is ${status.toLowerCase()}.`,
      referenceType: 'PAYMENT',
      referenceId: transactionId,
    });
  }

  /**
   * Get notification history for a user.
   */
  static async getHistory(userId: number, limit = 50, offset = 0): Promise<any[]> {
    const db = await getDb();
    return db.all(
      `SELECT * FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    );
  }

  /**
   * Get or create notification preferences for a user.
   */
  static async getPreferences(userId: number): Promise<any> {
    const db = await getDb();
    let prefs = await db.get('SELECT * FROM notification_preferences WHERE user_id = ?', [userId]);

    if (!prefs) {
      await db.run(
        `INSERT INTO notification_preferences (user_id) VALUES (?)`,
        [userId]
      );
      prefs = await db.get('SELECT * FROM notification_preferences WHERE user_id = ?', [userId]);
    }

    return prefs;
  }

  /**
   * Update notification preferences for a user.
   */
  static async updatePreferences(userId: number, updates: Partial<{
    emailEnabled: boolean;
    smsEnabled: boolean;
    pushEnabled: boolean;
    bookingUpdates: boolean;
    paymentUpdates: boolean;
    promotional: boolean;
  }>): Promise<void> {
    const db = await getDb();

    const fieldMap: Record<string, string> = {
      emailEnabled: 'email_enabled',
      smsEnabled: 'sms_enabled',
      pushEnabled: 'push_enabled',
      bookingUpdates: 'booking_updates',
      paymentUpdates: 'payment_updates',
      promotional: 'promotional',
    };

    const sets: string[] = [];
    const values: any[] = [];

    for (const [key, dbField] of Object.entries(fieldMap)) {
      const val = (updates as any)[key];
      if (val !== undefined) {
        sets.push(`${dbField} = ?`);
        values.push(val ? 1 : 0);
      }
    }

    if (sets.length === 0) return;

    values.push(userId);
    await db.run(
      `INSERT INTO notification_preferences (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING`,
      [userId]
    );
    await db.run(
      `UPDATE notification_preferences SET ${sets.join(', ')} WHERE user_id = ?`,
      values
    );
  }
}
