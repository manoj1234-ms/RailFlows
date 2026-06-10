import { CacheService, CACHE_TTL } from '../services/cache.service';

jest.mock('../config/redis', () => ({
  getRedis: jest.fn(),
  isRedisReady: jest.fn(() => false),
}));

describe('CacheService', () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService();
  });

  describe('set and get', () => {
    it('stores and retrieves values within TTL', async () => {
      await cache.set('test-key', { foo: 'bar' }, 60);
      const result = await cache.get<any>('test-key');
      expect(result).toEqual({ foo: 'bar' });
    });

    it('returns undefined for expired entries', async () => {
      await cache.set('expired-key', 'value', 0);
      await new Promise(r => setTimeout(r, 10));
      const result = await cache.get('expired-key');
      expect(result).toBeUndefined();
    });

    it('returns undefined for missing keys', async () => {
      const result = await cache.get('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('invalidate', () => {
    it('removes single key', async () => {
      await cache.set('key1', 'value1', 60);
      await cache.invalidate('key1');
      const result = await cache.get('key1');
      expect(result).toBeUndefined();
    });
  });

  describe('invalidateByPrefix', () => {
    it('removes all keys with prefix', async () => {
      await cache.set('user:1', 'a', 60);
      await cache.set('user:2', 'b', 60);
      await cache.set('train:1', 'c', 60);

      const count = await cache.invalidateByPrefix('user:');

      expect(count).toBe(2);
      expect(await cache.get('user:1')).toBeUndefined();
      expect(await cache.get('user:2')).toBeUndefined();
      expect(await cache.get('train:1')).toBe('c');
    });
  });

  describe('flush', () => {
    it('clears all entries', async () => {
      await cache.set('a', 1, 60);
      await cache.set('b', 2, 60);
      await cache.flush();

      expect(await cache.get('a')).toBeUndefined();
      expect(await cache.get('b')).toBeUndefined();
    });
  });

  describe('getMetrics', () => {
    it('returns correct metrics', async () => {
      await cache.get('miss');
      await cache.set('hit', 'val', 60);
      await cache.get('hit');

      const metrics = cache.getMetrics();
      expect(metrics.totalKeys).toBe(1);
      expect(metrics.hitCount).toBe(1);
      expect(metrics.missCount).toBe(1);
      expect(metrics.hitRate).toBe('50.00%');
    });
  });

  describe('CACHE_TTL', () => {
    it('has all required TTL constants', () => {
      expect(CACHE_TTL.TRAIN_SEARCH).toBe(30);
      expect(CACHE_TTL.TRAIN_DETAILS).toBe(300);
      expect(CACHE_TTL.SEAT_AVAILABILITY).toBe(10);
      expect(CACHE_TTL.PAYMENT_METHODS).toBe(3600);
    });
  });
});
