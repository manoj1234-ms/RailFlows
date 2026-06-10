import { getDb } from '../config/db';

export interface EventBookingResult {
  success: boolean;
  pnr?: string;
  bookingId?: number;
  message: string;
}

export class EventService {
  private static generatePNR(): string {
    return 'EV' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  }

  static async listEvents(category?: string, city?: string, page: number = 1, limit: number = 20): Promise<{ events: any[]; total: number }> {
    const db = await getDb();
    let where = 'WHERE status = $1';
    const params: any[] = ['ACTIVE'];
    let idx = 2;

    if (category) {
      where += ` AND category = $${idx++}`;
      params.push(category.toUpperCase());
    }
    if (city) {
      where += ` AND LOWER(city) LIKE $${idx++}`;
      params.push(`%${city.toLowerCase()}%`);
    }

    const countResult = await db.get<{ count: number }>(`SELECT COUNT(*) as count FROM events ${where}`, params);
    const total = countResult?.count ?? 0;

    const offset = (page - 1) * limit;
    const events = await db.all(
      `SELECT * FROM events ${where} ORDER BY date LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );

    return { events, total };
  }

  static async getEvent(eventId: number): Promise<any> {
    const db = await getDb();
    return db.get('SELECT * FROM events WHERE id = $1', [eventId]);
  }

  static async getSeatMap(eventId: number): Promise<any[]> {
    const db = await getDb();
    return db.all(
      'SELECT * FROM event_seats WHERE event_id = $1 ORDER BY section, row_label, seat_number',
      [eventId]
    );
  }

  static async lockSeats(eventId: number, userId: number, section: string, rowLabel: string, seatNumbers: number[]): Promise<EventBookingResult> {
    const db = await getDb();
    const expiresAt = new Date(Date.now() + 300 * 1000).toISOString();
    const locked: number[] = [];

    for (const seatNum of seatNumbers) {
      const result = await db.run(
        `UPDATE event_seats SET status = 'LOCKED', locked_by = $1, lock_expires_at = $2
         WHERE event_id = $3 AND section = $4 AND row_label = $5 AND seat_number = $6
         AND status = 'AVAILABLE'`,
        [userId, expiresAt, eventId, section, rowLabel, seatNum]
      );
      if ((result.changes ?? 0) > 0) {
        locked.push(seatNum);
      } else {
        for (const r of locked) {
          await db.run(
            `UPDATE event_seats SET status = 'AVAILABLE', locked_by = NULL, lock_expires_at = NULL
             WHERE event_id = $1 AND section = $2 AND row_label = $3 AND seat_number = $4`,
            [eventId, section, rowLabel, r]
          );
        }
        return { success: false, message: `Seat ${rowLabel}-${seatNum} unavailable` };
      }
    }

    return { success: true, message: `Locked ${locked.length} seats for 5 minutes` };
  }

  static async confirmBooking(
    eventId: number, userId: number, section: string, rowLabel: string,
    seatNumbers: number[], totalPrice: number
  ): Promise<EventBookingResult> {
    const db = await getDb();
    const pnr = this.generatePNR();

    await db.run('BEGIN TRANSACTION;');
    try {
      const res = await db.run(
        `INSERT INTO event_bookings (user_id, event_id, pnr, status, seats, total_price)
         VALUES ($1, $2, $3, 'CONFIRMED', $4, $5) RETURNING id`,
        [userId, eventId, pnr, JSON.stringify(seatNumbers), totalPrice]
      );
      const bookingId = res.lastID!;

      for (const seatNum of seatNumbers) {
        await db.run(
          `UPDATE event_seats SET status = 'BOOKED', locked_by = NULL, lock_expires_at = NULL, booking_id = $1
           WHERE event_id = $2 AND section = $3 AND row_label = $4 AND seat_number = $5`,
          [bookingId, eventId, section, rowLabel, seatNum]
        );
      }

      await db.run(
        'UPDATE events SET available_seats = available_seats - $1 WHERE id = $2',
        [seatNumbers.length, eventId]
      );

      await db.run('COMMIT;');
      return { success: true, pnr, bookingId, message: 'Event booking confirmed' };
    } catch (e: any) {
      await db.run('ROLLBACK;');
      return { success: false, message: `Booking failed: ${e.message}` };
    }
  }
}
