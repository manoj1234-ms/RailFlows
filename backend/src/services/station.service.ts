import { getDb } from '../config/db';

export class StationService {
  /**
   * Autocomplete stations by name or code.
   */
  static async autocomplete(query: string, limit = 10): Promise<any[]> {
    const db = await getDb();
    const search = `%${query}%`;
    const stations = await db.all(
      `SELECT code, name, city, state, zone
       FROM stations
       WHERE code ILIKE $1 OR name ILIKE $1 OR city ILIKE $1
       ORDER BY
         CASE WHEN code ILIKE $2 THEN 0
              WHEN name ILIKE $2 THEN 1
              WHEN city ILIKE $2 THEN 3
              ELSE 4 END,
         name
       LIMIT $3`,
      [search, `${query}%`, limit]
    );
    return stations.map((s: any) => ({
      ...s,
      label: `${s.city} - ${s.name} (${s.code})`,
      shortLabel: `${s.city} - ${s.code}`,
    }));
  }

  /**
   * Get station details by code.
   */
  static async getByCode(code: string): Promise<any> {
    const db = await getDb();
    const station = await db.get('SELECT * FROM stations WHERE code = $1', [code.toUpperCase()]);
    if (!station) return null;

    // Get trains passing through this station
    const trains = await db.all(
      `SELECT t.train_number, t.name, tr.arrival_time, tr.departure_time, tr.stop_number, tr.distance_km, tr.platform
       FROM train_routes tr
       JOIN trains t ON t.train_number = tr.train_number
       WHERE tr.station_code = $1
       ORDER BY tr.train_number, tr.stop_number`,
      [code.toUpperCase()]
    );

    return { ...station, trains };
  }

  /**
   * List all stations (paginated).
   */
  static async list(limit = 50, offset = 0): Promise<any[]> {
    const db = await getDb();
    return db.all(
      'SELECT code, name, city, state, zone, latitude, longitude FROM stations ORDER BY state, city LIMIT $1 OFFSET $2',
      [limit, offset]
    );
  }

  /**
   * Find nearby stations by approximate lat/lng bounding box.
   */
  static async getNearby(lat: number, lng: number, radiusKm = 50): Promise<any[]> {
    const db = await getDb();
    const latDelta = radiusKm / 111.0;
    const lngDelta = radiusKm / (111.0 * Math.cos((lat * Math.PI) / 180));

    return db.all(
      `SELECT * FROM (
        SELECT code, name, city, state,
               (6371 * ACOS(
                 COS(RADIANS($1)) * COS(RADIANS(latitude)) *
                 COS(RADIANS(longitude) - RADIANS($2)) +
                 SIN(RADIANS($1)) * SIN(RADIANS(latitude))
               )) AS distance_km
        FROM stations
        WHERE latitude BETWEEN $3 AND $4
          AND longitude BETWEEN $5 AND $6
      ) sub
      WHERE distance_km <= $7
      ORDER BY distance_km
      LIMIT 20`,
      [lat, lng, lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta, radiusKm]
    );
  }
}
