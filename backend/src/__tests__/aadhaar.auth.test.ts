import request from 'supertest';
import { createApp } from '../index';
import { SmsService } from '../services/sms.service';

jest.mock('../config/db', () => ({
  getDb: jest.fn(() => ({
    get: jest.fn(),
    run: jest.fn().mockResolvedValue({ changes: 1, lastID: 1 }),
    all: jest.fn(),
  })),
  getPool: jest.fn(),
}));

jest.mock('../services/sms.service', () => ({
  SmsService: {
    sendOtp: jest.fn().mockResolvedValue(true),
  },
}));

const otpStore: Record<string, string> = {};

jest.mock('../config/redis', () => {
  const mockRedisClient = {
    call: jest.fn((cmd: string, ...args: any[]) => {
      const command = cmd.toUpperCase();
      if (command === 'SCRIPT' && args[0]?.toUpperCase() === 'LOAD') {
        return 'mocked-sha';
      }
      if (command === 'EVALSHA') {
        return [1, 60000]; // returns [totalHits, timeToExpire]
      }
      return null;
    }),
    setex: jest.fn(async (key: string, ttl: number, val: string) => {
      otpStore[key] = val;
      return 'OK';
    }),
    get: jest.fn(async (key: string) => {
      return otpStore[key] || null;
    }),
    del: jest.fn(async (key: string) => {
      delete otpStore[key];
      return 1;
    }),
  };
  return {
    getRedis: jest.fn(() => mockRedisClient),
    isRedisReady: jest.fn(() => true),
  };
});

jest.mock('../middleware/csrf', () => ({
  csrfProtection: jest.fn((req, res, next) => next()),
  setCsrfToken: jest.fn((req, res, next) => next()),
}));

describe('Aadhaar Auth Endpoints', () => {
  let app: any;

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key in otpStore) {
      delete otpStore[key];
    }
  });

  beforeAll(() => {
    app = createApp();
  });

  describe('POST /api/v1/auth/aadhaar/send-otp', () => {
    it('sends OTP for a valid 12-digit Aadhaar number and phone number', async () => {
      const res = await request(app)
        .post('/api/v1/auth/aadhaar/send-otp')
        .send({ aadhaar: '123456789012', phone: '9876543210' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.message).toContain('OTP sent successfully');
      expect(SmsService.sendOtp).toHaveBeenCalledTimes(1);
      
      const sentOtp = (SmsService.sendOtp as jest.Mock).mock.calls[0][1];
      expect(sentOtp).toMatch(/^\d{6}$/); // should be a 6 digit number string
    });

    it('fails for invalid Aadhaar format', async () => {
      const res = await request(app)
        .post('/api/v1/auth/aadhaar/send-otp')
        .send({ aadhaar: '1234', phone: '9876543210' });

      expect(res.status).toBe(400);
    });

    it('fails for invalid phone format', async () => {
      const res = await request(app)
        .post('/api/v1/auth/aadhaar/send-otp')
        .send({ aadhaar: '123456789012', phone: '9876' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/auth/aadhaar/verify-otp', () => {
    it('verifies correct code', async () => {
      // First, trigger OTP generation
      await request(app)
        .post('/api/v1/auth/aadhaar/send-otp')
        .send({ aadhaar: '123456789012', phone: '9876543210' });

      const sentOtp = (SmsService.sendOtp as jest.Mock).mock.calls[0][1];

      // Verify OTP
      const res = await request(app)
        .post('/api/v1/auth/aadhaar/verify-otp')
        .send({ aadhaar: '123456789012', code: sentOtp });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('rejects incorrect code', async () => {
      // First, trigger OTP generation
      await request(app)
        .post('/api/v1/auth/aadhaar/send-otp')
        .send({ aadhaar: '123456789012', phone: '9876543210' });

      // Verify incorrect OTP
      const res = await request(app)
        .post('/api/v1/auth/aadhaar/verify-otp')
        .send({ aadhaar: '123456789012', code: '000000' });

      expect(res.status).toBe(400);
      expect(res.body.status).toBe('error');
    });
  });
});
