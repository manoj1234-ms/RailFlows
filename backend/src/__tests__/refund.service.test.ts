import { RefundService } from '../services/refund.service';

jest.mock('../config/db', () => ({
  getDb: jest.fn(),
}));

jest.mock('../services/email.service', () => ({
  sendRefundEmail: jest.fn().mockResolvedValue(true),
}));

jest.mock('../services/payment.service', () => ({
  PaymentService: {
    processRefund: jest.fn().mockResolvedValue({ success: true, message: 'Refund processed' }),
  },
}));

const mockGetDb = require('../config/db').getDb;

describe('RefundService', () => {
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

  describe('initiateRefund', () => {
    it('processes full refund flow', async () => {
      mockDb.get
        .mockResolvedValueOnce({ id: 1, user_id: 1, status: 'CONFIRMED', pnr: '1234567890', price: 1000, created_at: new Date(Date.now() - 72 * 3600 * 1000).toISOString() })
        .mockResolvedValueOnce({ id: 1, amount: 1000, status: 'SUCCESS' })
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ email: 'test@test.com' });
      mockDb.run.mockResolvedValue({ changes: 1, lastID: 1 });

      const result = await RefundService.initiateRefund(1, 1, 'Customer request');

      expect(result.status).toBe('COMPLETED');
      expect(result.amount).toBe(900);
      expect(mockDb.run).toHaveBeenCalled();
    });

    it('flags high-risk refunds for admin approval', async () => {
      mockDb.get
        .mockResolvedValueOnce({ id: 1, user_id: 1, status: 'CONFIRMED', pnr: '1234567890', price: 1000, created_at: new Date(Date.now() - 200 * 3600 * 1000).toISOString() })
        .mockResolvedValueOnce({ id: 1, amount: 1000, status: 'SUCCESS' })
        .mockResolvedValueOnce({ count: 10 })
        .mockResolvedValueOnce({ count: 5 })
        .mockResolvedValueOnce({ email: 'test@test.com' });
      mockDb.run.mockResolvedValue({ changes: 1, lastID: 2 });

      const result = await RefundService.initiateRefund(1, 1, 'change of mind');

      expect(result.status).toBe('PENDING');
      expect(result.riskScore).toBeGreaterThan(0.6);
    });

    it('rejects refund for already cancelled booking', async () => {
      mockDb.get.mockResolvedValueOnce({ id: 1, user_id: 1, status: 'CANCELLED', pnr: '1234567890', price: 1000 });

      await expect(
        RefundService.initiateRefund(1, 1, 'Test')
      ).rejects.toThrow('Booking already cancelled');
    });

    it('rejects refund for non-existent booking', async () => {
      mockDb.get.mockResolvedValueOnce(null);

      await expect(
        RefundService.initiateRefund(999, 1, 'Test')
      ).rejects.toThrow('Booking not found');
    });
  });

  describe('predictRefund', () => {
    it('returns prediction for a valid booking', async () => {
      mockDb.get
        .mockResolvedValueOnce({ id: 1, user_id: 1, status: 'CONFIRMED', price: 1000, created_at: new Date().toISOString() })
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 0 });

      const result = await RefundService.predictRefund(1, 1, 'Medical emergency');

      expect(result.recommendedRefundPct).toBeGreaterThan(0);
      expect(result.processingEtaHours).toBeGreaterThan(0);
      expect(result.riskScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe('adminReviewRefund', () => {
    it('approves pending refund', async () => {
      mockDb.get
        .mockResolvedValueOnce({ id: 1, booking_id: 1, user_id: 1, amount: 900, status: 'PENDING', refund_pct: 90 })
        .mockResolvedValueOnce({ id: 1, amount: 1000, status: 'SUCCESS' });
      mockDb.run.mockResolvedValue({ changes: 1 });

      const result = await RefundService.adminReviewRefund(1, 2, 'APPROVE');
      expect(result.status).toBe('COMPLETED');
      expect(result.amount).toBe(900);
    });

    it('rejects pending refund', async () => {
      mockDb.get.mockResolvedValueOnce({ id: 1, status: 'PENDING' });
      mockDb.run.mockResolvedValue({ changes: 1 });

      const result = await RefundService.adminReviewRefund(1, 2, 'REJECT');
      expect(result.status).toBe('REJECTED');
    });
  });

  describe('getRefundStatus', () => {
    it('returns refund status', async () => {
      mockDb.get.mockResolvedValue({ id: 1, status: 'COMPLETED', amount: 900 });

      const result = await RefundService.getRefundStatus(1, 1);

      expect(result.status).toBe('COMPLETED');
      expect(result.amount).toBe(900);
    });

    it('throws for missing refund', async () => {
      mockDb.get.mockResolvedValue(null);

      await expect(
        RefundService.getRefundStatus(999, 1)
      ).rejects.toThrow('No refund found');
    });
  });
});
