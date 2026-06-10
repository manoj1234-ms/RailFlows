import { QueueService, queueBanRegistry } from '../services/queue.service';

jest.mock('../config/db', () => ({
  getDb: jest.fn(),
}));

const mockGetDb = require('../config/db').getDb;

describe('QueueService', () => {
  let mockDb: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = {
      get: jest.fn(),
      run: jest.fn(),
      all: jest.fn(),
    };
    mockGetDb.mockResolvedValue(mockDb);
    queueBanRegistry.clear();
  });

  describe('generateTokenHash', () => {
    it('generates deterministic hash', () => {
      const hash1 = QueueService.generateTokenHash(1, '127.0.0.1', 'fp123');
      const hash2 = QueueService.generateTokenHash(1, '127.0.0.1', 'fp123');

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('generates different hashes for different inputs', () => {
      const hash1 = QueueService.generateTokenHash(1, '127.0.0.1', 'fp123');
      const hash2 = QueueService.generateTokenHash(2, '127.0.0.1', 'fp123');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('getOrCreateQueueToken', () => {
    it('creates new queue token for new user', async () => {
      mockDb.get
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ seq: 6 })
        .mockResolvedValueOnce({
          token: 'abc123',
          user_id: 1,
          queue_position: 6,
          estimated_wait_seconds: 30,
          booking_window_expires_at: null,
          created_at: new Date().toISOString(),
        });
      mockDb.run.mockResolvedValue({ changes: 1 });

      const result = await QueueService.getOrCreateQueueToken(1, '127.0.0.1', 'fp123');

      expect(result.originalPosition).toBe(6);
    });

    it('rejects banned user', async () => {
      queueBanRegistry.set(1, Date.now() + 100000);

      await expect(
        QueueService.getOrCreateQueueToken(1, '127.0.0.1', 'fp123')
      ).rejects.toThrow(/suspended/);
    });
  });

  describe('verifyBookingAccess', () => {
    it('allows admin users without queue', async () => {
      mockDb.get.mockResolvedValue({ role: 'Admin' });

      const result = await QueueService.verifyBookingAccess(1);

      expect(result).toBe(true);
    });

    it('allows user with active booking window', async () => {
      const futureDate = new Date(Date.now() + 60000).toISOString();
      mockDb.get.mockResolvedValue({ role: 'Passenger' });
      mockDb.all.mockResolvedValue([
        {
          token: 'abc',
          user_id: 1,
          queue_position: 0,
          estimated_wait_seconds: 0,
          booking_window_expires_at: futureDate,
          created_at: new Date().toISOString(),
        },
      ]);
      mockDb.run.mockResolvedValue({ changes: 1 });

      const result = await QueueService.verifyBookingAccess(1);

      expect(result).toBe(true);
    });
  });

  describe('getQueueMetrics', () => {
    it('returns queue metrics', async () => {
      mockDb.get
        .mockResolvedValueOnce({ count: 10 })
        .mockResolvedValueOnce({ count: 3 });

      const metrics = await QueueService.getQueueMetrics();

      expect(metrics.activeQueueLength).toBe(10);
      expect(metrics.averageWaitSeconds).toBe(3000);
      expect(metrics.throughput).toBe(36);
    });
  });
});
