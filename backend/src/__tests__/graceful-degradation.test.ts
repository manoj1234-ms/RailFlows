import { SeatLockService } from '../services/lock.service';

jest.mock('../config/db', () => ({
  getDb: jest.fn(),
}));

jest.mock('../config/redis', () => {
  let redisReady = true;
  return {
    getRedis: jest.fn(() => ({
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(1),
      keys: jest.fn().mockResolvedValue([]),
    })),
    isRedisReady: jest.fn(() => redisReady),
    __setRedisReady: (v: boolean) => { redisReady = v; },
  };
});

jest.mock('../services/queue.service', () => ({
  addSeatExpiryJob: jest.fn(),
}));

const mockGetDb = require('../config/db').getDb;

describe('Graceful Degradation (Redis offline)', () => {
  let mockDb: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = {
      get: jest.fn(),
      run: jest.fn(),
      all: jest.fn(),
    };
    mockGetDb.mockResolvedValue(mockDb);
    require('../config/redis').__setRedisReady(false);
  });

  it('acquires lock via DB when Redis is down', async () => {
    mockDb.run.mockResolvedValue({ changes: 1 });

    const result = await SeatLockService.acquireSeatLock('12951', 'B1', 5, 1);

    expect(result).toBe(true);
    expect(mockDb.run).toHaveBeenCalled();
  });

  it('releases lock via DB when Redis is down', async () => {
    mockDb.run.mockResolvedValue({ changes: 1 });

    const result = await SeatLockService.releaseSeatLock('12951', 'B1', 5, 1);

    expect(result).toBe(true);
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE seats'),
      expect.any(Array)
    );
  });

  it('cleans up expired locks via DB when Redis is down', async () => {
    mockDb.run.mockResolvedValue({ changes: 3 });

    const cleaned = await SeatLockService.cleanupExpiredLocks();

    expect(cleaned).toBe(3);
  });
});
