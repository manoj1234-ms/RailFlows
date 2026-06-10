import { getDb } from '../config/db';

export class LiveTrackingService {
  /**
   * Get live status for a train.
   */
  static async getLiveStatus(trainNumber: string): Promise<any> {
    const db = await getDb();

    const live = await db.get(
      `SELECT l.*, cs.name AS current_station_name, cs.city AS current_city,
              ns.name AS next_station_name, ns.city AS next_city
       FROM live_train_status l
       LEFT JOIN stations cs ON l.current_station = cs.code
       LEFT JOIN stations ns ON l.next_station = ns.code
       WHERE l.train_number = $1`,
      [trainNumber]
    );

    if (!live) return null;

    // Also get the full schedule
    const schedule = await db.all(
      `SELECT tr.stop_number, tr.station_code, s.name AS station_name, s.city,
              tr.arrival_time, tr.departure_time, tr.distance_km, tr.day_count, tr.platform
       FROM train_routes tr
       JOIN stations s ON tr.station_code = s.code
       WHERE tr.train_number = $1
       ORDER BY tr.stop_number`,
      [trainNumber]
    );

    const train = await db.get('SELECT name FROM trains WHERE train_number = $1', [trainNumber]);

    return {
      trainNumber,
      trainName: train?.name || '',
      status: live.status,
      delayMinutes: live.delay_minutes,
      speedKmh: live.speed_kmh,
      currentStation: {
        code: live.current_station,
        name: live.current_station_name,
        city: live.current_city,
      },
      nextStation: live.next_station ? {
        code: live.next_station,
        name: live.next_station_name,
        city: live.next_city,
      } : null,
      expectedArrival: live.expected_arrival,
      lastUpdated: live.last_updated,
      route: schedule,
    };
  }

  /**
   * Simulate train movement (advance one station).
   */
  static async simulateAdvance(trainNumber: string): Promise<boolean> {
    const db = await getDb();

    const current = await db.get(
      'SELECT * FROM live_train_status WHERE train_number = $1',
      [trainNumber]
    );
    if (!current) return false;

    const nextStop = await db.get(
      `SELECT tr.*, s.name AS station_name
       FROM train_routes tr
       JOIN stations s ON tr.station_code = s.code
       WHERE tr.train_number = $1
         AND tr.station_code > $2
       ORDER BY tr.stop_number
       LIMIT 1`,
      [trainNumber, current.current_station]
    );

    if (!nextStop) return false;

    await db.run(
      `UPDATE live_train_status
       SET current_station = $1, next_station = $2, status = 'DEPARTED',
           last_updated = CURRENT_TIMESTAMP, speed_kmh = $3
       WHERE train_number = $4`,
      [nextStop.station_code, null, 90 + Math.floor(Math.random() * 30), trainNumber]
    );

    return true;
  }

  /**
   * Get all trains currently running with live status.
   */
  static async getAllRunning(): Promise<any[]> {
    const db = await getDb();
    return db.all(
      `SELECT l.train_number, t.name AS train_name, l.status, l.delay_minutes,
              l.speed_kmh, l.last_updated,
              cs.name AS current_station, ns.name AS next_station
       FROM live_train_status l
       JOIN trains t ON l.train_number = t.train_number
       LEFT JOIN stations cs ON l.current_station = cs.code
       LEFT JOIN stations ns ON l.next_station = ns.code
       WHERE l.status NOT IN ('ARRIVED', 'CANCELLED')
       ORDER BY l.train_number`
    );
  }
}
