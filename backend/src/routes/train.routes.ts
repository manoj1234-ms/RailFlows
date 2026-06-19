import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getDb } from '../config/db';
import { validate } from '../middleware/validate';
import { searchRateLimiter } from '../middleware/rateLimiter';
import { SeatLockService } from '../services/lock.service';
import { cache, CACHE_TTL } from '../services/cache.service';
import { RailwayApiService } from '../services/railway-api.service';

const router = Router();

// Validation Schemas
const searchSchema = {
  query: z.object({
    from: z.string().min(2),
    to: z.string().min(2),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  }),
};

const trainIdSchema = {
  params: z.object({
    id: z.string(),
  }),
};

const coachSchema = {
  params: z.object({
    id: z.string(),
  }),
  query: z.object({
    class: z.enum(['1A', '2A', '3A', 'SL']),
  }),
};

// Helper: Quick fuzzy search matching score (Levenshtein/Jaro-Winkler approximation)
function calculateStationMatchScore(search: string, station: string): number {
  const s = search.toLowerCase();
  const st = station.toLowerCase();
  
  if (st.includes(s)) return 100; // Substring match
  
  // Calculate common prefix/characters
  let common = 0;
  for (let i = 0; i < Math.min(s.length, st.length); i++) {
    if (s[i] === st[i]) common++;
  }
  return (common / search.length) * 100;
}

// GET Train Search endpoint (Rate Limited + Cached)
router.get('/search', searchRateLimiter, validate(searchSchema), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { from, to, date } = req.query as any;
  const cacheKey = `train_search:${from}:${to}:${date}`;

  const cached = await cache.get<any[]>(cacheKey);
  if (cached) {
    res.status(200).json({ status: 'success', data: cached, source: 'cache' });
    return;
  }

  const db = await getDb();

  try {
    // 1. Resolve inputs to station codes
    const getStationCode = async (query: string): Promise<string> => {
      const q = query.trim().toUpperCase();
      if (/^[A-Z]{3,5}$/.test(q)) {
        return q;
      }
      const parenMatch = q.match(/\(([^)]+)\)/);
      if (parenMatch && parenMatch[1]) {
        const code = parenMatch[1].trim().toUpperCase();
        if (/^[A-Z]{3,5}$/.test(code)) return code;
      }
      // Query local database for code
      const matched = await db.get(
        'SELECT code FROM stations WHERE code = ? OR name ILIKE ? OR city ILIKE ? LIMIT 1',
        [q, `%${q}%`, `%${q}%`]
      );
      return matched ? matched.code : q;
    };

    const fromCode = await getStationCode(from);
    const toCode = await getStationCode(to);

    // 2. Fetch trains from live API or fallback
    const liveTrains = await RailwayApiService.getTrainsBetweenStations(fromCode, toCode, date);

    // 3. For any new trains/stations returned by live API, dynamically sync them to local database
    if (liveTrains && liveTrains.length > 0) {
      // Make sure the stations exist in local DB (to satisfy Foreign Key constraints in bookings/routes)
      await db.run(
        `INSERT INTO stations (code, name, city, state, zone, latitude, longitude)
         VALUES (?, ?, ?, 'Unknown', 'Unknown', 0, 0)
         ON CONFLICT (code) DO NOTHING`,
        [fromCode, from, from]
      );
      await db.run(
        `INSERT INTO stations (code, name, city, state, zone, latitude, longitude)
         VALUES (?, ?, ?, 'Unknown', 'Unknown', 0, 0)
         ON CONFLICT (code) DO NOTHING`,
        [toCode, to, to]
      );

      for (const train of liveTrains) {
        // Check if train exists
        let dbTrain = await db.get('SELECT * FROM trains WHERE train_number = ?', [train.train_number]);
        if (!dbTrain) {
          // Sync train to DB
          await db.run(
            `INSERT INTO trains (train_number, name, from_station, to_station, departure_time, arrival_time, base_fare)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              train.train_number,
              train.name,
              train.from_station || fromCode,
              train.to_station || toCode,
              train.departure_time,
              train.arrival_time,
              train.base_fare || 500.0
            ]
          );

          // Sync default coaches
          await db.run(
            `INSERT INTO train_coaches (train_number, coach_class, coach_label, position_from_engine, total_seats)
             VALUES 
               (?, '1A', 'A1', 1, 9),
               (?, '3A', 'B1', 2, 18),
               (?, 'SL', 'S1', 3, 18)
             ON CONFLICT (train_number, coach_label) DO NOTHING`,
            [train.train_number, train.train_number, train.train_number]
          );

          // Seed seats for the new train using a single bulk insert to reduce DB round-trips
          const coachConfigs = [
            { coach_class: '1A', coach_label: 'A1', seat_count: 9 },
            { coach_class: '3A', coach_label: 'B1', seat_count: 18 },
            { coach_class: 'SL', coach_label: 'S1', seat_count: 18 },
          ];
          const placeholders: string[] = [];
          const params: any[] = [];
          for (const config of coachConfigs) {
            for (let i = 1; i <= config.seat_count; i++) {
              placeholders.push('(?, ?, ?, ?, \'AVAILABLE\')');
              params.push(train.train_number, config.coach_class, config.coach_label, i);
            }
          }
          if (placeholders.length > 0) {
            await db.run(
              `INSERT INTO seats (train_number, coach_class, coach_label, seat_number, status)
               VALUES ${placeholders.join(', ')}
               ON CONFLICT (train_number, coach_label, seat_number) DO NOTHING`,
              params
            );
          }
        }
      }
    }

    // 4. Map search results (getting available seats dynamically from synced tables)
    const results = [];
    const now = new Date().toISOString();
    
    // We filter from local DB matching search results so we return full detail rows with DB ids
    for (const train of liveTrains) {
      const dbTrain = await db.get('SELECT * FROM trains WHERE train_number = ?', [train.train_number]);
      if (dbTrain) {
        const seats = await db.all(
          'SELECT status, lock_expires_at FROM seats WHERE train_number = ?',
          [dbTrain.train_number]
        );
        const available = seats.filter(
          s => s.status === 'AVAILABLE' || (s.status === 'LOCKED' && datetimeExpired(s.lock_expires_at, now))
        ).length;

        const estFare = dbTrain.base_fare;
        results.push({
          id: dbTrain.id,
          trainNumber: dbTrain.train_number,
          name: dbTrain.name,
          fromStation: dbTrain.from_station,
          toStation: dbTrain.to_station,
          departureTime: dbTrain.departure_time,
          arrivalTime: dbTrain.arrival_time,
          baseFare: dbTrain.base_fare,
          availableSeatsCount: available,
          totalSeatsCount: seats.length,
          fareBreakup: {
            baseFare: estFare,
            reservationFee: Math.round(estFare * 0.05),
            superfastCharge: 0,
            convenienceFee: Math.round(estFare * 0.03) + 5,
            totalWithCharges: Math.round(estFare * 1.08) + 5,
          },
        });
      }
    }

    await cache.set(cacheKey, results, CACHE_TTL.TRAIN_SEARCH);

    res.status(200).json({
      status: 'success',
      data: results,
      source: 'railway-api',
    });
  } catch (error) {
    next(error);
  }
});

// GET Train Details (Cached)
router.get('/:id', validate(trainIdSchema), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { id } = req.params;
  const cacheKey = `train_details:${id}`;

  const cached = await cache.get<any>(cacheKey);
  if (cached) {
    res.status(200).json({ status: 'success', data: cached, source: 'cache' });
    return;
  }

  const db = await getDb();

  try {
    const train = await db.get('SELECT * FROM trains WHERE id = ? OR train_number = ?', [id, id]);
    if (!train) {
      res.status(404).json({ status: 'error', message: 'Train not found' });
      return;
    }

    const coaches = await db.all(
      `SELECT coach_class, coach_label, position_from_engine, total_seats
       FROM train_coaches WHERE train_number = $1 ORDER BY position_from_engine`,
      [train.train_number]
    );

    const routeData = await db.all(
      `SELECT tr.stop_number, tr.station_code, s.name AS station_name, s.city,
              tr.arrival_time, tr.departure_time, tr.distance_km, tr.day_count, tr.platform
       FROM train_routes tr
       JOIN stations s ON tr.station_code = s.code
       WHERE tr.train_number = $1
       ORDER BY tr.stop_number`,
      [train.train_number]
    );

    const data = {
      id: train.id,
      trainNumber: train.train_number,
      name: train.name,
      fromStation: train.from_station,
      toStation: train.to_station,
      baseFare: train.base_fare,
      departureTime: train.departure_time,
      arrivalTime: train.arrival_time,
      totalDistance: routeData.length > 0 ? routeData[routeData.length - 1].distance_km : 0,
      coachComposition: coaches.map((c: any) => ({
        class: c.coach_class,
        label: c.coach_label,
        positionFromEngine: c.position_from_engine,
        totalSeats: c.total_seats,
      })),
      route: routeData.map((r: any) => ({
        stopNumber: r.stop_number,
        stationCode: r.station_code,
        stationName: r.station_name,
        city: r.city,
        arrivalTime: r.arrival_time,
        departureTime: r.departure_time,
        distanceKm: r.distance_km,
        dayCount: r.day_count,
        platform: r.platform,
      })),
    };

    await cache.set(cacheKey, data, CACHE_TTL.TRAIN_DETAILS);

    res.status(200).json({
      status: 'success',
      data,
      source: 'database',
    });
  } catch (error) {
    next(error);
  }
});

// GET Coach Layout Maps & Seat Status
router.get('/:id/coach', validate(coachSchema), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { id } = req.params;
  const coachClass = req.query.class as string;
  const db = await getDb();

  try {
    const train = await db.get('SELECT train_number FROM trains WHERE id = ? OR train_number = ?', [id, id]);
    if (!train) {
      res.status(404).json({ status: 'error', message: 'Train not found' });
      return;
    }

    // Clean expired locks before checking seats
    await SeatLockService.cleanupExpiredLocks();

    const seats = await db.all(
      `SELECT id, coach_class, coach_label, seat_number, status, locked_by, lock_expires_at 
       FROM seats 
       WHERE train_number = ? AND coach_class = ?
       ORDER BY coach_label, seat_number`,
      [train.train_number, coachClass]
    );

    // Map seats into DTO containing remaining seconds countdowns
    const mappedSeats = seats.map(s => {
      let remainingSeconds = 0;
      let computedStatus = s.status;

      if (s.status === 'LOCKED' && s.lock_expires_at) {
        const expires = new Date(s.lock_expires_at).getTime();
        const diff = expires - Date.now();
        if (diff <= 0) {
          computedStatus = 'AVAILABLE';
        } else {
          remainingSeconds = Math.floor(diff / 1000);
        }
      }

      return {
        id: s.id,
        coachLabel: s.coach_label,
        seatNumber: s.seat_number,
        status: computedStatus,
        remainingSeconds: computedStatus === 'LOCKED' ? remainingSeconds : 0,
      };
    });

    res.status(200).json({
      status: 'success',
      data: {
        trainNumber: train.train_number,
        coachClass,
        seats: mappedSeats,
      },
    });
  } catch (error) {
    next(error);
  }
});

function datetimeExpired(expiresAt: string | null, nowIso: string): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() < new Date(nowIso).getTime();
}

// GET Fare Calendar (cheapest fares ±7 days)
router.get('/fare/calendar', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const from = req.query.from as string;
  const to = req.query.to as string;

  if (!from || !to) {
    res.status(400).json({ status: 'error', message: 'from and to stations required' });
    return;
  }

  const db = await getDb();
  const cacheKey = `fare_calendar:${from}:${to}`;
  const cached = await cache.get<any>(cacheKey);
  if (cached) {
    res.status(200).json({ status: 'success', data: cached, source: 'cache' });
    return;
  }

  try {
    const trains = await db.all(
      `SELECT t.train_number, t.name, t.base_fare, t.departure_time, t.arrival_time,
              tr1.distance_km AS from_dist, tr2.distance_km AS to_dist
       FROM trains t
       JOIN train_routes tr1 ON t.train_number = tr1.train_number AND tr1.station_code = $1
       JOIN train_routes tr2 ON t.train_number = tr2.train_number AND tr2.station_code = $2
       WHERE tr1.stop_number < tr2.stop_number`,
      [from.toUpperCase(), to.toUpperCase()]
    );

    const calendar: any[] = [];
    for (let d = -7; d <= 7; d++) {
      const date = new Date();
      date.setDate(date.getDate() + d);
      const dateStr = date.toISOString().split('T')[0];
      const dayOfWeek = date.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const weekendMultiplier = isWeekend ? 1.2 : 1.0;

      const dayTrains = trains.map((t: any) => {
        const distance = t.to_dist - t.from_dist;
        const fare = Math.round(t.base_fare * weekendMultiplier);
        return {
          trainNumber: t.train_number,
          trainName: t.name,
          departureTime: t.departure_time,
          arrivalTime: t.arrival_time,
          distanceKm: distance,
          fare,
          isWeekend,
          fareBreakup: {
            baseFare: fare,
            reservationFee: Math.round(fare * 0.05),
            superfastCharge: distance > 500 ? Math.round(fare * 0.08) : 0,
            convenienceFee: Math.round(fare * 0.03) + 5,
            totalWithCharges: Math.round(fare * 1.16) + 5,
          },
        };
      });

      dayTrains.sort((a: any, b: any) => a.fare - b.fare);

      calendar.push({
        date: dateStr,
        dayName: date.toLocaleDateString('en-IN', { weekday: 'short' }),
        isWeekend,
        cheapestFare: dayTrains.length > 0 ? dayTrains[0].fare : null,
        cheapestTrain: dayTrains.length > 0 ? dayTrains[0].trainName : null,
        trains: dayTrains.slice(0, 3),
      });
    }

    await cache.set(cacheKey, calendar, CACHE_TTL.TRAIN_SEARCH);
    res.status(200).json({ status: 'success', data: calendar, source: 'database' });
  } catch (error) {
    next(error);
  }
});

// GET Date Range Search
router.get('/search/range', searchRateLimiter, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { from, to, startDate, endDate } = req.query as any;

  if (!from || !to || !startDate || !endDate) {
    res.status(400).json({ status: 'error', message: 'from, to, startDate, endDate required (YYYY-MM-DD)' });
    return;
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  if (daysDiff > 90) {
    res.status(400).json({ status: 'error', message: 'Date range max 90 days' });
    return;
  }

  const db = await getDb();

  try {
    const trains = await db.all(
      `SELECT t.train_number, t.name, t.base_fare, t.departure_time, t.arrival_time,
              tr1.distance_km AS from_dist, tr2.distance_km AS to_dist
       FROM trains t
       JOIN train_routes tr1 ON t.train_number = tr1.train_number AND tr1.station_code = $1
       JOIN train_routes tr2 ON t.train_number = tr2.train_number AND tr2.station_code = $2
       WHERE tr1.stop_number < tr2.stop_number`,
      [from.toUpperCase(), to.toUpperCase()]
    );

    const results: any[] = [];
    for (let d = 0; d <= daysDiff; d++) {
      const date = new Date(start);
      date.setDate(date.getDate() + d);
      const dateStr = date.toISOString().split('T')[0];

      for (const t of trains) {
        const distance = t.to_dist - t.from_dist;
        const fare = Math.round(t.base_fare * (date.getDay() === 0 || date.getDay() === 6 ? 1.2 : 1.0));
        results.push({
          date: dateStr,
          trainNumber: t.train_number,
          trainName: t.name,
          departureTime: t.departure_time,
          arrivalTime: t.arrival_time,
          distanceKm: distance,
          fare,
          fareBreakup: {
            baseFare: fare,
            reservationFee: Math.round(fare * 0.05),
            superfastCharge: distance > 500 ? Math.round(fare * 0.08) : 0,
            convenienceFee: Math.round(fare * 0.03) + 5,
            totalWithCharges: Math.round(fare * 1.16) + 5,
          },
        });
      }
    }

    res.status(200).json({ status: 'success', data: results });
  } catch (error) {
    next(error);
  }
});

export default router;
