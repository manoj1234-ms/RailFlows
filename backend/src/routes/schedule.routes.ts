import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getDb } from '../config/db';
import { validate } from '../middleware/validate';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { LiveTrackingService } from '../services/live-tracking.service';
import { cache, CACHE_TTL } from '../services/cache.service';
import { RailwayApiService } from '../services/railway-api.service';

const router = Router();

const trainNumberSchema = {
  params: z.object({
    number: z.string(),
  }),
};

const fareEnquirySchema = {
  query: z.object({
    from: z.string().min(2),
    to: z.string().min(2),
  }),
};

const betweenStationsSchema = {
  query: z.object({
    from: z.string().min(2),
    to: z.string().min(2),
    date: z.string().optional(),
    dateOfJourney: z.string().optional(),
  }),
};

// GET Train schedule (full route with all stops)
router.get('/:number', validate(trainNumberSchema), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { number } = req.params;
  const cacheKey = `schedule:${number}`;

  const cached = await cache.get<any>(cacheKey);
  if (cached) {
    res.status(200).json({ status: 'success', data: cached, source: 'cache' });
    return;
  }

  const db = await getDb();

  try {
    const train = await db.get('SELECT * FROM trains WHERE train_number = $1', [number]);
    if (!train) {
      res.status(404).json({ status: 'error', message: 'Train not found' });
      return;
    }

    const route = await db.all(
      `SELECT tr.stop_number, tr.station_code, s.name AS station_name, s.city, s.state,
              tr.arrival_time, tr.departure_time, tr.distance_km, tr.day_count, tr.platform
       FROM train_routes tr
       JOIN stations s ON tr.station_code = s.code
       WHERE tr.train_number = $1
       ORDER BY tr.stop_number`,
      [number]
    );

    const data = {
      trainNumber: train.train_number,
      trainName: train.name,
      fromStation: train.from_station,
      toStation: train.to_station,
      departureTime: train.departure_time,
      arrivalTime: train.arrival_time,
      baseFare: train.base_fare,
      totalStops: route.length,
      totalDistance: route.length > 0 ? route[route.length - 1].distance_km : 0,
      route,
    };

    await cache.set(cacheKey, data, CACHE_TTL.TRAIN_DETAILS);
    res.status(200).json({ status: 'success', data, source: 'database' });
  } catch (error) {
    next(error);
  }
});

// GET Live train status
router.get('/:number/live', validate(trainNumberSchema), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { number } = req.params;

  try {
    const status = await RailwayApiService.getLiveStatus(number);
    if (!status) {
      res.status(404).json({ status: 'error', message: 'Live tracking not available for this train' });
      return;
    }
    res.status(200).json({ status: 'success', data: status });
  } catch (error) {
    next(error);
  }
});

// GET All running trains
router.get('/live/all', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const trains = await LiveTrackingService.getAllRunning();
    res.status(200).json({ status: 'success', data: trains });
  } catch (error) {
    next(error);
  }
});

// GET Fare enquiry between two stations
router.get('/fare/enquiry', validate(fareEnquirySchema), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const from = (req.query.from as string).toUpperCase();
  const to = (req.query.to as string).toUpperCase();
  const cacheKey = `fare:${from}:${to}`;

  const cached = await cache.get<any>(cacheKey);
  if (cached) {
    res.status(200).json({ status: 'success', data: cached, source: 'cache' });
    return;
  }

  const db = await getDb();

  try {
    const trains = await db.all(
      `SELECT DISTINCT t.train_number, t.name, t.from_station, t.to_station,
              t.departure_time, t.arrival_time, t.base_fare
       FROM trains t
       JOIN train_routes tr1 ON t.train_number = tr1.train_number AND tr1.station_code = $1
       JOIN train_routes tr2 ON t.train_number = tr2.train_number AND tr2.station_code = $2
       WHERE tr1.stop_number < tr2.stop_number`,
      [from, to]
    );

    if (trains.length === 0) {
      res.status(404).json({ status: 'error', message: 'No trains found between these stations' });
      return;
    }

    const results = [];
    for (const train of trains) {
      const stops = await db.all(
        `SELECT s.name AS station_name, tr.stop_number, tr.arrival_time, tr.departure_time, tr.distance_km
         FROM train_routes tr
         JOIN stations s ON tr.station_code = s.code
         WHERE tr.train_number = $1
           AND tr.stop_number BETWEEN (
             SELECT stop_number FROM train_routes WHERE train_number = $1 AND station_code = $2
           ) AND (
             SELECT stop_number FROM train_routes WHERE train_number = $1 AND station_code = $3
           )
         ORDER BY tr.stop_number`,
        [train.train_number, from, to]
      );

      const totalRoute = await db.all(
        `SELECT distance_km FROM train_routes WHERE train_number = $1 ORDER BY stop_number DESC LIMIT 1`,
        [train.train_number]
      );
      const totalDistance = totalRoute.length > 0 ? totalRoute[0].distance_km : 1;
      const distance = stops.length > 0 ? stops[stops.length - 1].distance_km - stops[0].distance_km : 0;
      const farePerKm = train.base_fare / totalDistance;
      const estimatedFare = Math.round(distance * farePerKm);

      results.push({
        trainNumber: train.train_number,
        trainName: train.name,
        departureTime: train.departure_time,
        arrivalTime: train.arrival_time,
        distanceKm: distance,
        estimatedFare,
        classes: [
          { class: '1A', fare: Math.round(estimatedFare * 2.5) },
          { class: '2A', fare: Math.round(estimatedFare * 1.8) },
          { class: '3A', fare: Math.round(estimatedFare * 1.3) },
          { class: 'SL', fare: estimatedFare },
        ],
        fareBreakup: {
          baseFare: estimatedFare,
          reservationFee: Math.round(estimatedFare * 0.05),
          superfastCharge: distance > 500 ? Math.round(estimatedFare * 0.08) : 0,
          convenienceFee: Math.round(estimatedFare * 0.03) + 5,
          totalWithCharges: Math.round(estimatedFare * 1.16) + 5,
        },
        stops: stops.map((s: any) => ({
          station: s.station_name,
          arrival: s.arrival_time,
          departure: s.departure_time,
          distance: s.distance_km,
        })),
      });
    }

    await cache.set(cacheKey, results, CACHE_TTL.TRAIN_SEARCH);
    res.status(200).json({ status: 'success', data: results, source: 'database' });
  } catch (error) {
    next(error);
  }
});

// GET Trains between two stations (public schedule lookup)
router.get('/between/stations', validate(betweenStationsSchema), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const from = (req.query.from as string).toUpperCase();
  const to = (req.query.to as string).toUpperCase();
  const dateOfJourney = (req.query.dateOfJourney || req.query.date) as string | undefined;

  try {
    const trains = await RailwayApiService.getTrainsBetweenStations(from, to, dateOfJourney);
    res.status(200).json({ status: 'success', data: trains, source: 'railway-api' });
  } catch (error) {
    next(error);
  }
});

// GET Vikalp — Alternate train suggestions (IRCTC Vikalp scheme)
router.get('/vikalp/alternates', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const from = (req.query.from as string)?.toUpperCase();
  const to = (req.query.to as string)?.toUpperCase();
  const preferredTrain = (req.query.prefer as string)?.toUpperCase();

  if (!from || !to) {
    res.status(400).json({ status: 'error', message: 'from and to stations required' });
    return;
  }

  const db = await getDb();
  const cacheKey = `vikalp:${from}:${to}:${preferredTrain || 'any'}`;
  const cached = await cache.get<any>(cacheKey);
  if (cached) {
    res.status(200).json({ status: 'success', data: cached, source: 'cache' });
    return;
  }

  try {
    const excludeClause = preferredTrain ? 'AND t.train_number != $3' : '';
    const params: any[] = [from, to];
    if (preferredTrain) params.push(preferredTrain);
    const trains = await db.all(
      `SELECT t.train_number, t.name, t.from_station, t.to_station,
              t.departure_time, t.arrival_time, t.base_fare,
              tr1.distance_km AS from_dist, tr2.distance_km AS to_dist,
              (tr2.distance_km - tr1.distance_km) AS travel_distance
       FROM trains t
       JOIN train_routes tr1 ON t.train_number = tr1.train_number AND tr1.station_code = $1
       JOIN train_routes tr2 ON t.train_number = tr2.train_number AND tr2.station_code = $2
       WHERE tr1.stop_number < tr2.stop_number
         ${excludeClause}
       ORDER BY travel_distance, t.base_fare`,
      params
    );

    const vikalpOptions = trains.map((t: any) => {
      const dist = t.travel_distance || 1;
      const totalRouteDist = t.from_dist + dist;
      const farePerKm = totalRouteDist > 0 ? t.base_fare / totalRouteDist : 1;
      const estFare = Math.round(dist * farePerKm);
      return {
        trainNumber: t.train_number,
        trainName: t.name,
        departureTime: t.departure_time,
        arrivalTime: t.arrival_time,
        travelDistance: dist,
        estimatedFare: estFare,
        savingsPercent: preferredTrain ? -1 : null,
      };
    });

    await cache.set(cacheKey, vikalpOptions, CACHE_TTL.TRAIN_SEARCH);
    res.status(200).json({ status: 'success', data: vikalpOptions, source: 'database' });
  } catch (error) {
    next(error);
  }
});

export default router;
