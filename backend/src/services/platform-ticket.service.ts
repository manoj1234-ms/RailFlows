import { getDb } from '../config/db';

export interface PlatformTicketResult {
  success: boolean;
  pnr?: string;
  message: string;
}

export class PlatformTicketService {
  /**
   * Generates a 10-digit PNR for platform tickets.
   */
  private static generatePNR(): string {
    return '9' + Math.floor(100000000 + Math.random() * 900000000).toString();
  }

  /**
   * Book a platform ticket (entry to station, no train required).
   */
  static async bookPlatformTicket(
    userId: number,
    stationCode: string,
    passengerName: string,
    passengerAge: number
  ): Promise<PlatformTicketResult> {
    const db = await getDb();
    const pnr = this.generatePNR();
    const price = 10.0; // Platform ticket: ₹10

    const station = await db.get('SELECT * FROM stations WHERE code = $1', [stationCode.toUpperCase()]);
    if (!station) {
      return { success: false, message: 'Station not found' };
    }

    const validUntil = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2 hours validity

    try {
      await db.run(
        `INSERT INTO platform_tickets (user_id, pnr, from_station, type, price, status, passenger_name, passenger_age, valid_until)
         VALUES ($1, $2, $3, 'PLATFORM', $4, 'ACTIVE', $5, $6, $7)`,
        [userId, pnr, stationCode.toUpperCase(), price, passengerName, passengerAge, validUntil]
      );

      return {
        success: true,
        pnr,
        message: `Platform ticket booked for ${station.name}. Valid for 2 hours.`,
      };
    } catch (error: any) {
      return { success: false, message: `Failed to book platform ticket: ${error.message}` };
    }
  }

  /**
   * Book an unreserved general ticket (point-to-point, no seat).
   */
  static async bookUnreservedTicket(
    userId: number,
    fromStation: string,
    toStation: string,
    passengerName: string,
    passengerAge: number
  ): Promise<PlatformTicketResult> {
    const db = await getDb();
    const pnr = this.generatePNR();

    const from = await db.get('SELECT * FROM stations WHERE code = $1', [fromStation.toUpperCase()]);
    const to = await db.get('SELECT * FROM stations WHERE code = $1', [toStation.toUpperCase()]);

    if (!from || !to) {
      return { success: false, message: 'Station not found' };
    }

    const price = 30.0; // Unreserved: ₹30 flat
    const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

    try {
      await db.run(
        `INSERT INTO platform_tickets (user_id, pnr, from_station, to_station, type, price, status, passenger_name, passenger_age, valid_until)
         VALUES ($1, $2, $3, $4, 'UNRESERVED', $5, 'ACTIVE', $6, $7, $8)`,
        [userId, pnr, fromStation.toUpperCase(), toStation.toUpperCase(), price, passengerName, passengerAge, validUntil]
      );

      return {
        success: true,
        pnr,
        message: `Unreserved ticket booked from ${from.name} to ${to.name}. Valid for 24 hours.`,
      };
    } catch (error: any) {
      return { success: false, message: `Failed to book unreserved ticket: ${error.message}` };
    }
  }

  /**
   * Get ticket details by PNR.
   */
  static async getTicketByPNR(pnr: string): Promise<any> {
    const db = await getDb();
    const ticket = await db.get(
      `SELECT pt.*, fs.name AS from_station_name, ts.name AS to_station_name
       FROM platform_tickets pt
       LEFT JOIN stations fs ON pt.from_station = fs.code
       LEFT JOIN stations ts ON pt.to_station = ts.code
       WHERE pt.pnr = $1`,
      [pnr]
    );
    return ticket;
  }

  /**
   * Get all tickets for a user.
   */
  static async getUserTickets(userId: number): Promise<any[]> {
    const db = await getDb();
    return db.all(
      `SELECT pt.*, fs.name AS from_station_name, ts.name AS to_station_name
       FROM platform_tickets pt
       LEFT JOIN stations fs ON pt.from_station = fs.code
       LEFT JOIN stations ts ON pt.to_station = ts.code
       WHERE pt.user_id = $1
       ORDER BY pt.created_at DESC`,
      [userId]
    );
  }

  /**
   * Cancel a platform/unreserved ticket.
   */
  static async cancelTicket(pnr: string, userId: number): Promise<PlatformTicketResult> {
    const db = await getDb();

    const ticket = await db.get(
      'SELECT * FROM platform_tickets WHERE pnr = $1',
      [pnr]
    );

    if (!ticket) {
      return { success: false, message: 'Ticket not found' };
    }

    if (ticket.user_id !== userId) {
      return { success: false, message: 'Access Denied' };
    }

    if (ticket.status !== 'ACTIVE') {
      return { success: false, message: `Ticket is already ${ticket.status.toLowerCase()}` };
    }

    await db.run(
      "UPDATE platform_tickets SET status = 'CANCELLED' WHERE pnr = $1",
      [pnr]
    );

    return { success: true, pnr, message: 'Ticket cancelled successfully' };
  }
}
