import { SeatLockService } from '../services/lock.service';

jest.mock('../config/db', () => ({
  getDb: jest.fn(),
}));

jest.mock('../config/redis', () => ({
  getRedis: jest.fn(),
  isRedisReady: jest.fn(() => false),
}));

jest.mock('../services/queue.service', () => ({
  addSeatExpiryJob: jest.fn(),
}));

const mockGetDb = require('../config/db').getDb;

describe('SeatLockService', () => {
  let mockDb: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = {
      get: jest.fn(),
      run: jest.fn(),
      all: jest.fn(),
    };
    mockGetDb.mockResolvedValue(mockDb);
  });

  describe('acquireSeatLock', () => {
    it('acquires lock when seat is AVAILABLE', async () => {
      mockDb.run.mockResolvedValue({ changes: 1 });

      const result = await SeatLockService.acquireSeatLock('12951', 'B1', 5, 1);

      expect(result).toBe(true);
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE seats'),
        expect.arrayContaining([1, expect.any(String), '12951', 'B1', 5, expect.any(String)])
      );
    });

    it('fails when seat is already locked by another user', async () => {
      mockDb.run.mockResolvedValue({ changes: 0 });

      const result = await SeatLockService.acquireSeatLock('12951', 'B1', 5, 2);

      expect(result).toBe(false);
    });

    it('re-acquires lock when previous lock has expired', async () => {
      mockDb.run.mockResolvedValue({ changes: 1 });

      const result = await SeatLockService.acquireSeatLock('12951', 'B1', 5, 1);

      expect(result).toBe(true);
    });
  });

  describe('releaseSeatLock', () => {
    it('releases lock owned by the user', async () => {
      mockDb.run.mockResolvedValue({ changes: 1 });

      const result = await SeatLockService.releaseSeatLock('12951', 'B1', 5, 1);

      expect(result).toBe(true);
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE seats'),
        expect.arrayContaining(['12951', 'B1', 5, 1])
      );
    });

    it('fails to release lock not owned by user', async () => {
      mockDb.run.mockResolvedValue({ changes: 0 });

      const result = await SeatLockService.releaseSeatLock('12951', 'B1', 5, 2);

      expect(result).toBe(false);
    });
  });

  describe('getLockStatus', () => {
    it('returns lock status for a seat', async () => {
      mockDb.get.mockResolvedValue({
        status: 'LOCKED',
        locked_by: 1,
        lock_expires_at: new Date(Date.now() + 100000).toISOString(),
      });

      const status = await SeatLockService.getLockStatus('12951', 'B1', 5);

      expect(status.status).toBe('LOCKED');
      expect(status.lockedBy).toBe(1);
      expect(status.remainingSeconds).toBeGreaterThan(0);
    });

    it('throws error for non-existent seat', async () => {
      mockDb.get.mockResolvedValue(null);

      await expect(
        SeatLockService.getLockStatus('12951', 'B1', 999)
      ).rejects.toThrow('Seat not found');
    });
  });
});
