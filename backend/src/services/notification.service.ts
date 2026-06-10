import { getDb } from '../config/db';

export interface NotificationPayload {
  userId: number;
  type: 'EMAIL' | 'SMS' | 'PUSH';
  channel: string;
  subject?: string;
  body: string;
  referenceType?: string;
  referenceId?: string;
}

export class NotificationService {
  /**
   * Send a notification (email/SMS/push simulation).
   */
  static async send(payload: NotificationPayload): Promise<boolean> {
    const db = await getDb();

    try {
      // Simulate delivery delay
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Check user preferences before sending
      const prefs = await db.get(
        'SELECT * FROM notification_preferences WHERE user_id = ?',
        [payload.userId]
      );

      const typeKey = `${payload.type.toLowerCase()}_enabled` as keyof typeof prefs;
      if (prefs && prefs[typeKey] === 0) {
        console.log(`[Notification Service] Skipped ${payload.type} for User #${payload.userId} (disabled in preferences)`);
        return false;
      }

      const channelMap: Record<string, string> = {
        EMAIL: `${payload.channel || 'email@example.com'}`,
        SMS: `${payload.channel || '+91XXXXXXXXXX'}`,
        PUSH: `Device::${payload.channel || 'default-device'}`,
      };

      const destination = channelMap[payload.type] || payload.channel;
      console.log(`[Notification Service] ${payload.type} sent to ${destination}: "${payload.subject || 'No Subject'}"`);

      await db.run(
        `INSERT INTO notifications (user_id, type, channel, subject, body, status, reference_type, reference_id)
         VALUES (?, ?, ?, ?, ?, 'SENT', ?, ?)`,
        [
          payload.userId,
          payload.type,
          destination,
          payload.subject || null,
          payload.body,
          payload.referenceType || null,
          payload.referenceId || null,
        ]
      );

      return true;
    } catch (error: any) {
      console.error(`[Notification Service] Failed to send ${payload.type}: ${error.message}`);

      await db.run(
        `INSERT INTO notifications (user_id, type, channel, subject, body, status, reference_type, reference_id)
         VALUES (?, ?, ?, ?, ?, 'FAILED', ?, ?)`,
        [
          payload.userId,
          payload.type,
          payload.channel,
          payload.subject || null,
          payload.body,
          payload.referenceType || null,
          payload.referenceId || null,
        ]
      );

      return false;
    }
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
