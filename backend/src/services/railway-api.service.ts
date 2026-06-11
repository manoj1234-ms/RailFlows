import { getDb } from '../config/db';
import { cache, CACHE_TTL } from './cache.service';
import logger from '../utils/logger';

// Token Bucket for Throttling external API requests
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private maxTokens: number;
  private refillRatePerSecond: number;

  constructor(maxTokens = 2, refillRatePerSecond = 0.5) {
    this.maxTokens = maxTokens;
    this.refillRatePerSecond = refillRatePerSecond;
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  private refill() {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsedSeconds * this.refillRatePerSecond);
    this.lastRefill = now;
  }

  async acquire(): Promise<boolean> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

export class RailwayApiService {
  private static limiter = new TokenBucket(2, 0.5); // Rate limit: 1 request per 2 seconds

  /**
   * Helper to make rate-limited requests to external API.
   * Returns null if key is not configured, rate limited, or if request fails.
   */
  private static async makeRequest<T>(url: string): Promise<T | null> {
    const apiKey = process.env.RAPIDAPI_KEY;
    if (!apiKey) {
      logger.debug('[Railway API] RAPIDAPI_KEY is not set. Using local database fallback.');
      return null;
    }

    const hasToken = await this.limiter.acquire();
    if (!hasToken) {
      logger.warn('[Railway API] External request throttled by internal rate limiter. Falling back to local data.');
      return null;
    }

    const host = process.env.RAPIDAPI_HOST || 'irctc1.p.rapidapi.com';
    try {
      logger.info(`[Railway API] Fetching external data from: ${url}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': host,
          'Accept': 'application/json',
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.warn(`[Railway API] External request failed with status: ${response.status}`);
        return null;
      }

      const body = await response.json();
      return body as T;
    } catch (err: any) {
      logger.error(`[Railway API] Error during external request: ${err.message}`);
      return null;
    }
  }

  /**
   * Fetch trains between stations.
   * Falls back to local database query if external API fails or is not configured.
   */
  static async getTrainsBetweenStations(fromCode: string, toCode: string): Promise<any[]> {
    const cleanFrom = fromCode.toUpperCase().trim();
    const cleanTo = toCode.toUpperCase().trim();
    const cacheKey = `ext_between:${cleanFrom}:${cleanTo}`;

    // 1. Check Cache
    const cached = await cache.get<any[]>(cacheKey);
    if (cached) {
      logger.debug(`[Railway API] Cache hit for trains between ${cleanFrom} and ${cleanTo}`);
      return cached;
    }

    // 2. Attempt External RapidAPI search
    // Using standard endpoint format: /api/v3/trainBetweenStations
    const host = process.env.RAPIDAPI_HOST || 'irctc1.p.rapidapi.com';
    const extUrl = `https://${host}/api/v3/trainBetweenStations?fromStationCode=${cleanFrom}&toStationCode=${cleanTo}`;
    
    const extRes = await this.makeRequest<any>(extUrl);
    if (extRes && extRes.status && extRes.data) {
      // Map RapidAPI response format to RailFlow format
      // RapidAPI returns a list under data: e.g. [{ train_number, train_name, from, to, ... }]
      const mappedList = extRes.data.map((t: any) => ({
        train_number: t.train_number || t.trainNumber,
        name: t.train_name || t.trainName,
        from_station: t.from || t.fromStationCode,
        to_station: t.to || t.toStationCode,
        departure_time: t.from_std || t.departureTime || '12:00',
        arrival_time: t.to_sta || t.arrivalTime || '20:00',
        base_fare: 500, // Default base fare
        board_at: t.from_std || '12:00',
        board_departure: t.from_std || '12:00',
        board_distance: 0,
        alight_at: t.to_sta || '20:00',
        alight_distance: 500,
        travel_distance: 500,
      }));

      await cache.set(cacheKey, mappedList, CACHE_TTL.TRAIN_SEARCH);
      return mappedList;
    }

    // 3. Fallback to Local SQL Database
    logger.info(`[Railway API] Falling back to local database search for: ${cleanFrom} -> ${cleanTo}`);
    const db = await getDb();
    const localTrains = await db.all(
      `SELECT t.train_number, t.name, t.from_station, t.to_station,
              t.departure_time, t.arrival_time, t.base_fare,
              tr1.arrival_time AS board_at, tr1.departure_time AS board_departure,
              tr1.distance_km AS board_distance,
              tr2.arrival_time AS alight_at, tr2.distance_km AS alight_distance,
              (tr2.distance_km - tr1.distance_km) AS travel_distance
       FROM trains t
       JOIN train_routes tr1 ON t.train_number = tr1.train_number AND tr1.station_code = $1
       JOIN train_routes tr2 ON t.train_number = tr2.train_number AND tr2.station_code = $2
       WHERE tr1.stop_number < tr2.stop_number
       ORDER BY travel_distance`,
      [cleanFrom, cleanTo]
    );

    await cache.set(cacheKey, localTrains, CACHE_TTL.TRAIN_SEARCH);
    return localTrains;
  }

  /**
   * Fetch live status for a train.
   * Falls back to local simulated coordinates and DB data if API fails.
   */
  static async getLiveStatus(trainNumber: string): Promise<any> {
    const cleanNum = trainNumber.trim();
    const cacheKey = `ext_live:${cleanNum}`;

    // 1. Check Cache
    const cached = await cache.get<any>(cacheKey);
    if (cached) return cached;

    // 2. Attempt External RapidAPI query
    // e.g. /api/v1/liveTrainStatus?trainNo=12951
    const host = process.env.RAPIDAPI_HOST || 'irctc1.p.rapidapi.com';
    const extUrl = `https://${host}/api/v1/liveTrainStatus?trainNo=${cleanNum}&startDay=0`;

    const extRes = await this.makeRequest<any>(extUrl);
    if (extRes && extRes.status && extRes.data) {
      const d = extRes.data;
      const mappedStatus = {
        trainNumber: cleanNum,
        trainName: d.train_name || '',
        status: d.status || 'RUNNING',
        delayMinutes: d.delay || 0,
        speedKmh: d.current_speed || 80,
        currentStation: {
          code: d.current_station_code || '',
          name: d.current_station_name || '',
          city: d.current_station_name || '',
        },
        nextStation: d.next_station_code ? {
          code: d.next_station_code,
          name: d.next_station_name || '',
          city: d.next_station_name || '',
        } : null,
        expectedArrival: d.expected_arrival || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        lastUpdated: new Date().toISOString(),
        route: (d.stations || []).map((s: any, idx: number) => ({
          stop_number: idx + 1,
          station_code: s.station_code,
          station_name: s.station_name,
          arrival_time: s.actual_arrival || s.scheduled_arrival,
          departure_time: s.actual_departure || s.scheduled_departure,
          distance_km: s.distance || 0,
          platform: s.platform || '1',
        })),
      };

      await cache.set(cacheKey, mappedStatus, 60); // 1-minute TTL for live status
      return mappedStatus;
    }

    // 3. Fallback to Local Live Status (mock coordinate simulation)
    logger.info(`[Railway API] Falling back to local live tracking simulation for train: ${cleanNum}`);
    const db = await getDb();
    const live = await db.get(
      `SELECT l.*, cs.name AS current_station_name, cs.city AS current_city,
              ns.name AS next_station_name, ns.city AS next_city
       FROM live_train_status l
       LEFT JOIN stations cs ON l.current_station = cs.code
       LEFT JOIN stations ns ON l.next_station = ns.code
       WHERE l.train_number = $1`,
      [cleanNum]
    );

    if (!live) return null;

    const schedule = await db.all(
      `SELECT tr.stop_number, tr.station_code, s.name AS station_name, s.city,
              tr.arrival_time, tr.departure_time, tr.distance_km, tr.day_count, tr.platform
       FROM train_routes tr
       JOIN stations s ON tr.station_code = s.code
       WHERE tr.train_number = $1
       ORDER BY tr.stop_number`,
      [cleanNum]
    );

    const train = await db.get('SELECT name FROM trains WHERE train_number = $1', [cleanNum]);

    const localStatus = {
      trainNumber: cleanNum,
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

    await cache.set(cacheKey, localStatus, 60);
    return localStatus;
  }

  /**
   * Fetch real-world PNR status from the PNR Status Indian Railway API.
   * Caches response to optimize resource usage.
   */
  static async getPnrStatus(pnr: string): Promise<any | null> {
    const cleanPnr = pnr.trim();
    if (!/^\d{10}$/.test(cleanPnr)) {
      return null;
    }

    const cacheKey = `ext_pnr:${cleanPnr}`;
    const cached = await cache.get<any>(cacheKey);
    if (cached) {
      logger.debug(`[Railway API] Cache hit for PNR status: ${cleanPnr}`);
      return cached;
    }

    const apiKey = process.env.RAPIDAPI_KEY;
    if (!apiKey) {
      logger.debug('[Railway API] RAPIDAPI_KEY is not set. Using local database fallback for PNR lookup.');
      return null;
    }

    const host = 'pnr-status-indian-railway-pnr-check1.p.rapidapi.com';
    const url = `https://${host}/pnrno/${cleanPnr}`;

    const hasToken = await this.limiter.acquire();
    if (!hasToken) {
      logger.warn('[Railway API] PNR status query throttled by internal rate limiter.');
      return null;
    }

    try {
      logger.info(`[Railway API] Fetching external PNR status from: ${url}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': host,
          'Accept': 'application/json',
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.warn(`[Railway API] PNR request failed with status: ${response.status}`);
        return null;
      }

      const body = await response.json();
      if (body) {
        await cache.set(cacheKey, body, 300); // Cache for 5 minutes (300 seconds)
        return body;
      }
      return null;
    } catch (err: any) {
      logger.error(`[Railway API] Error during PNR status request: ${err.message}`);
      return null;
    }
  }
}
