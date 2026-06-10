import { getRedis, isRedisReady } from '../config/redis';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  createdAt: number;
}

const REDIS_PREFIX = 'cache:';

export class CacheService {
  private store = new Map<string, CacheEntry<any>>();
  private hitCount = 0;
  private missCount = 0;
  private redisHitCount = 0;
  private redisMissCount = 0;

  private redisKey(key: string): string {
    return `${REDIS_PREFIX}${key}`;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (entry && Date.now() <= entry.expiresAt) {
      this.hitCount++;
      return entry.data as T;
    }
    if (entry) {
      this.store.delete(key);
    }

    if (isRedisReady()) {
      try {
        const redis = getRedis();
        const raw = await redis.get(this.redisKey(key));
        if (raw) {
          const parsed: CacheEntry<T> = JSON.parse(raw);
          if (Date.now() <= parsed.expiresAt) {
            this.store.set(key, parsed);
            this.redisHitCount++;
            return parsed.data as T;
          }
          await redis.del(this.redisKey(key));
        }
      } catch {
        this.redisMissCount++;
      }
    }

    this.missCount++;
    return undefined;
  }

  async set<T>(key: string, data: T, ttlSeconds: number): Promise<void> {
    const entry: CacheEntry<T> = {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
      createdAt: Date.now(),
    };
    this.store.set(key, entry);

    if (isRedisReady()) {
      try {
        const redis = getRedis();
        await redis.set(
          this.redisKey(key),
          JSON.stringify(entry),
          'EX',
          ttlSeconds
        );
      } catch { }
    }
  }

  async invalidate(key: string): Promise<boolean> {
    const deleted = this.store.delete(key);
    if (isRedisReady()) {
      try {
        const redis = getRedis();
        await redis.del(this.redisKey(key));
      } catch { }
    }
    return deleted;
  }

  async invalidateByPrefix(prefix: string): Promise<number> {
    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        count++;
      }
    }
    if (isRedisReady()) {
      try {
        const redis = getRedis();
        const keys = await redis.keys(`${REDIS_PREFIX}${prefix}*`);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } catch { }
    }
    return count;
  }

  async flush(): Promise<void> {
    this.store.clear();
    this.hitCount = 0;
    this.missCount = 0;
    this.redisHitCount = 0;
    this.redisMissCount = 0;
    if (isRedisReady()) {
      try {
        const redis = getRedis();
        const keys = await redis.keys(`${REDIS_PREFIX}*`);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } catch { }
    }
  }

  getMetrics(): { totalKeys: number; hitCount: number; missCount: number; hitRate: string; redisHitCount: number; redisMissCount: number } {
    const total = this.hitCount + this.missCount;
    const hitRate = total > 0 ? ((this.hitCount / total) * 100).toFixed(2) + '%' : '0%';
    return {
      totalKeys: this.store.size,
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate,
      redisHitCount: this.redisHitCount,
      redisMissCount: this.redisMissCount,
    };
  }

  cleanupExpired(): number {
    let cleaned = 0;
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }
}

export const CACHE_TTL = {
  TRAIN_SEARCH: 30,
  TRAIN_DETAILS: 300,
  SEAT_AVAILABILITY: 10,
  PAYMENT_METHODS: 3600,
  ADMIN_ANALYTICS: 60,
  ADMIN_SERVICE_HEALTH: 15,
};

export const cache = new CacheService();
