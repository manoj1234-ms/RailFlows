import request from 'supertest';
import { createApp } from '../index';
import { RailwayApiService } from '../services/railway-api.service';
import { encrypt } from '../config/crypto';

// Global mock store
const mockDb = {
  get: jest.fn(),
  run: jest.fn().mockResolvedValue({ changes: 1, lastID: 1 }),
  all: jest.fn(),
};

jest.mock('../config/db', () => ({
  getDb: jest.fn(() => mockDb),
  getPool: jest.fn(),
}));

jest.mock('../middleware/auth', () => ({
  authenticate: jest.fn((req: any, res: any, next: any) => {
    req.user = { id: 1, email: 'passenger@railflow.com', role: 'Passenger', mfaVerified: true };
    next();
  }),
  requireRole: jest.fn(() => (req: any, res: any, next: any) => next()),
  requireMfaForAdmins: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock('../services/queue.service', () => ({
  QueueService: {
    verifyBookingAccess: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('../services/lock.service', () => ({
  SeatLockService: {
    getLockStatus: jest.fn().mockResolvedValue({ status: 'LOCKED', lockedBy: 1, remainingSeconds: 100 }),
    releaseSeatLock: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('../middleware/csrf', () => ({
  csrfProtection: jest.fn((req, res, next) => next()),
  setCsrfToken: jest.fn((req, res, next) => next()),
}));

describe('Compliance & Railway API Integration Tests', () => {
  let app: any;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RAPIDAPI_KEY = '';
  });

  beforeAll(() => {
    app = createApp();
  });

  describe('DPDP Act 2023 & Aadhaar Compliance', () => {
    it('fails booking when Aadhaar is provided but consent is not given', async () => {
      const res = await request(app)
        .post('/api/v1/bookings/confirm')
        .send({
          trainNumber: '12951',
          coachLabel: 'A1',
          seatNumbers: [1],
          passengers: [{ name: 'Rahul Sharma', age: 25, gender: 'M', aadhaar: '123456789012' }],
          paymentMethod: 'UPI',
          paymentDetails: { upiId: 'rahul@upi' },
          idempotencyKey: 'idem_key_no_consent_' + Math.random().toString(36).slice(2),
          aadhaarConsentGiven: false,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Explicit consent is required');
    });

    it('allows booking when Aadhaar is provided and consent is given', async () => {
      mockDb.get.mockImplementation(async (sql) => {
        if (sql.includes('FROM trains')) {
          return { base_fare: 100, name: 'Mumbai Express' };
        }
        return null;
      });

      const res = await request(app)
        .post('/api/v1/bookings/confirm')
        .send({
          trainNumber: '12951',
          coachLabel: 'A1',
          seatNumbers: [1],
          passengers: [{ name: 'Rahul Sharma', age: 25, gender: 'M', aadhaar: '123456789012' }],
          paymentMethod: 'UPI',
          paymentDetails: { upiId: 'rahul@upi' },
          idempotencyKey: 'idem_key_consent_ok_' + Math.random().toString(36).slice(2),
          aadhaarConsentGiven: true,
        });

      expect(res.status).toBe(200);
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO aadhaar_consents'),
        expect.any(Array)
      );
    });

    it('masks name and Aadhaar for public PNR lookup', async () => {
      mockDb.get.mockResolvedValue({
        id: 10,
        user_id: 2,
        train_number: '12951',
        pnr: '9876543210',
        status: 'CONFIRMED',
        price: 200,
        passengers: JSON.stringify([{ name: 'John Doe', age: 30, gender: 'M', aadhaar: '123456789012' }]),
      });

      const res = await request(app).get('/api/v1/bookings/pnr/9876543210');

      expect(res.status).toBe(200);
      expect(res.body.data.passengers[0].name).toBe('J*** D**');
      expect(res.body.data.passengers[0].maskedAadhaar).toBe('XXXX-XXXX-XXXX');
    });

    it('decrypts Aadhaar and returns it masked to XXXX-XXXX-1234 on authenticated ticket view', async () => {
      const encryptedAadhaar = encrypt('123456789012');
      mockDb.get.mockResolvedValue({
        id: 10,
        user_id: 1, // Matches authenticated user id
        train_number: '12951',
        pnr: '9876543210',
        status: 'CONFIRMED',
        price: 200,
        passengers: JSON.stringify([{ name: 'John Doe', age: 30, gender: 'M', aadhaar: encryptedAadhaar }]),
      });

      const res = await request(app)
        .get('/api/v1/bookings/ticket/9876543210')
        .set('Authorization', 'Bearer dummy_jwt');

      expect(res.status).toBe(200);
      expect(res.body.data.passengers[0].name).toBe('John Doe');
      expect(res.body.data.passengers[0].maskedAadhaar).toBe('XXXX-XXXX-9012');
      
      // Verifies audit logging of Aadhaar access
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('AUDIT_AADHAAR_ACCESS'),
        expect.any(Array)
      );
    });
  });

  describe('PCI-DSS Compliance', () => {
    it('fails card booking if raw credit card details are passed to confirm booking endpoint', async () => {
      const res = await request(app)
        .post('/api/v1/bookings/confirm')
        .send({
          trainNumber: '12951',
          coachLabel: 'A1',
          seatNumbers: [1],
          passengers: [{ name: 'Rahul Sharma', age: 25, gender: 'M', aadhaar: '123456789012' }],
          paymentMethod: 'Credit Card',
          paymentDetails: {
            cardNumber: '1234567812345678',
            cardExpiry: '12/28',
            cardCvv: '123',
            cardholderName: 'Rahul Sharma',
          },
          idempotencyKey: 'idem_raw_card_' + Math.random().toString(36).slice(2),
          aadhaarConsentGiven: true,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Raw card credentials cannot be processed');
    });

    it('fails card booking if paymentToken is missing for card payment method', async () => {
      const res = await request(app)
        .post('/api/v1/bookings/confirm')
        .send({
          trainNumber: '12951',
          coachLabel: 'A1',
          seatNumbers: [1],
          passengers: [{ name: 'Rahul Sharma', age: 25, gender: 'M', aadhaar: '123456789012' }],
          paymentMethod: 'Credit Card',
          paymentDetails: {
            cardholderName: 'Rahul Sharma',
          },
          idempotencyKey: 'idem_missing_token_' + Math.random().toString(36).slice(2),
          aadhaarConsentGiven: true,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Payment token is required');
    });

    it('succeeds card booking if paymentToken is provided', async () => {
      mockDb.get.mockImplementation(async (sql) => {
        if (sql.includes('FROM trains')) {
          return { base_fare: 100, name: 'Mumbai Express' };
        }
        return null;
      });

      const res = await request(app)
        .post('/api/v1/bookings/confirm')
        .send({
          trainNumber: '12951',
          coachLabel: 'A1',
          seatNumbers: [1],
          passengers: [{ name: 'Rahul Sharma', age: 25, gender: 'M', aadhaar: '123456789012' }],
          paymentMethod: 'Credit Card',
          paymentDetails: {
            paymentToken: 'tok_mock_visa1234',
            cardholderName: 'Rahul Sharma',
          },
          idempotencyKey: 'idem_card_token_ok_' + Math.random().toString(36).slice(2),
          aadhaarConsentGiven: true,
        });

      expect(res.status).toBe(200);
    });
  });

  describe('RailwayApiService Caching & Fallback', () => {
    it('falls back to local database when RapidAPI credentials are not present', async () => {
      mockDb.all.mockResolvedValue([
        { train_number: '12951', name: 'Mumbai Express', from_station: 'NDLS', to_station: 'MMCT', base_fare: 100 }
      ]);

      const trains = await RailwayApiService.getTrainsBetweenStations('NDLS', 'MMCT');

      expect(trains.length).toBe(1);
      expect(trains[0].train_number).toBe('12951');
      expect(mockDb.all).toHaveBeenCalled();
    });
  });
});
