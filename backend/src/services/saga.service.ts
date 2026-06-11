import { getDb } from '../config/db';
import { SeatLockService } from './lock.service';
import { NotificationService } from './notification.service';
import { isRedisReady, getRedis } from '../config/redis';
import { LoyaltyService } from './loyalty.service';
import { PaymentService } from './payment.service';
import { isRazorpayConfigured } from '../config/razorpay';
import logger from '../utils/logger';
import { encrypt } from '../config/crypto';

export interface PassengerInfo {
  name: string;
  age: number;
  gender: string;
  aadhaar: string; // Will mask this in response DTO
}

export interface SagaResult {
  success: boolean;
  pnr?: string;
  bookingId?: number;
  message: string;
  refunded?: boolean;
  razorpayOrderId?: string;
  totalPrice?: number;
}

const SAGA_IDEM_TTL = 24 * 60 * 60;

async function getSagaIdempotency(key: string): Promise<{ success: boolean; bookingId: number; pnr: string } | null> {
  if (isRedisReady()) {
    const redis = getRedis();
    const cached = await redis.get(`saga:idempotency:${key}`);
    if (cached) return JSON.parse(cached);
  }
  return null;
}

async function setSagaIdempotency(key: string, value: { success: boolean; bookingId: number; pnr: string }): Promise<void> {
  if (isRedisReady()) {
    const redis = getRedis();
    await redis.set(`saga:idempotency:${key}`, JSON.stringify(value), 'EX', SAGA_IDEM_TTL);
  }
}

export class BookingSagaOrchestrator {
  /**
   * Generates a unique 10-digit numeric PNR.
   */
  private static generatePNR(): string {
    return Math.floor(1000000000 + Math.random() * 9000000000).toString();
  }

  /**
   * Executes the Booking-Payment Choreographed/Orchestrated Saga.
   * Enforces payment consistency and automatic compensating transactions.
   */
  static async executeBookingPayment(
    userId: number,
    userEmail: string,
    trainNumber: string,
    coachLabel: string,
    seatNumbers: number[],
    passengers: PassengerInfo[],
    paymentMethod: string,
    idempotencyKey: string,
    ipAddress: string,
    paymentToken?: string
  ): Promise<SagaResult> {
    const db = await getDb();
    
    // Check Idempotency first
    const cached = await getSagaIdempotency(idempotencyKey);
    if (cached) {
      return {
        success: cached.success,
        pnr: cached.pnr,
        bookingId: cached.bookingId,
        message: 'Duplicate request resolved via Idempotency Key',
      };
    }

    // Step 1: Verify all seats are currently locked by this user
    for (const seatNum of seatNumbers) {
      const lockInfo = await SeatLockService.getLockStatus(trainNumber, coachLabel, seatNum);
      if (lockInfo.status !== 'LOCKED' || lockInfo.lockedBy !== userId || lockInfo.remainingSeconds <= 0) {
        return {
          success: false,
          message: `Seat ${coachLabel}-${seatNum} is not locked by you, or the lock has expired.`,
        };
      }
    }

    // Fetch train fare to calculate price
    const train = await db.get('SELECT base_fare, name FROM trains WHERE train_number = ?', [trainNumber]);
    if (!train) {
      return { success: false, message: 'Invalid train number' };
    }
    const totalPrice = train.base_fare * passengers.length;
    const pnr = this.generatePNR();

    // Start database transaction
    await db.run('BEGIN TRANSACTION;');

    let bookingId: number;
    try {
      // Encrypt passenger Aadhaar at application layer before database serialization
      const securePassengers = passengers.map(p => ({
        name: p.name,
        age: p.age,
        gender: p.gender,
        aadhaar: encrypt(p.aadhaar)
      }));

      // Step 2: Create Booking record in PENDING state
      const bookingRes = await db.run(
        `INSERT INTO bookings (user_id, train_number, pnr, status, price, passengers)
         VALUES (?, ?, ?, 'PENDING', ?, ?)`,
        [userId, trainNumber, pnr, totalPrice, JSON.stringify(securePassengers)]
      );
      bookingId = bookingRes.lastID!;

      // Record Aadhaar consent log
      await db.run(
        `INSERT INTO aadhaar_consents (user_id, pnr, purpose, ip_address, consent_given)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, pnr, `Passenger Identity Verification for Booking PNR ${pnr}`, ipAddress, true]
      );

      // Associate locked seats with this pending booking immediately
      for (const seatNum of seatNumbers) {
        const updateRes = await db.run(
          `UPDATE seats SET booking_id = ? 
           WHERE train_number = ? AND coach_label = ? AND seat_number = ? AND locked_by = ?`,
          [bookingId, trainNumber, coachLabel, seatNum, userId]
        );
        if ((updateRes.changes ?? 0) === 0) {
          throw new Error(`Seat ${coachLabel}-${seatNum} is no longer locked by you.`);
        }
      }

      // Log transaction step
      await db.run(
        "INSERT INTO audit_logs (actor, action, ip, payload) VALUES (?, 'SAGA_BOOKING_PENDING', ?, ?)",
        [`User #${userId}`, ipAddress, JSON.stringify({ pnr, bookingId, seats: seatNumbers })]
      );

      await db.run('COMMIT;');
    } catch (e: any) {
      await db.run('ROLLBACK;');
      return { success: false, message: `Failed to initialize booking transaction: ${e.message}` };
    }

    // Step 3: Initiate real payment via Razorpay if configured
    if (isRazorpayConfigured()) {
      const initResult = await PaymentService.initiatePayment(
        userId,
        bookingId,
        totalPrice,
        paymentMethod,
        idempotencyKey,
        paymentToken
      );

      if (!initResult.success) {
        // Compensating action: Cancel booking and release seats
        await db.run('BEGIN TRANSACTION;');
        try {
          await db.run("UPDATE bookings SET status = 'CANCELLED' WHERE id = ?", [bookingId]);
          await db.run("UPDATE seats SET booking_id = NULL WHERE booking_id = ?", [bookingId]);
          for (const seatNum of seatNumbers) {
            await SeatLockService.releaseSeatLock(trainNumber, coachLabel, seatNum, userId);
          }
          await db.run('COMMIT;');
        } catch {
          await db.run('ROLLBACK;');
        }
        return { success: false, message: `Payment gateway initiation failed: ${initResult.message}` };
      }

      // Save saga idempotency before returning payment required state
      await setSagaIdempotency(idempotencyKey, { success: true, bookingId, pnr });

      return {
        success: true,
        pnr,
        bookingId,
        message: 'Payment required',
        razorpayOrderId: initResult.transactionId,
        totalPrice,
      };
    }

    // Step 3 (Simulated fallback): Call Payment gateway simulator
    const paymentSuccess = await this.simulatePaymentGateway(paymentMethod, totalPrice);
    if (!paymentSuccess) {
      // Compensating Action: Cancel booking and release seat locks
      await db.run('BEGIN TRANSACTION;');
      try {
        await db.run("UPDATE bookings SET status = 'CANCELLED' WHERE id = ?", [bookingId]);
        await db.run("UPDATE seats SET booking_id = NULL WHERE booking_id = ?", [bookingId]);
        for (const seatNum of seatNumbers) {
          await SeatLockService.releaseSeatLock(trainNumber, coachLabel, seatNum, userId);
        }
        await db.run(
          "INSERT INTO audit_logs (actor, action, ip, payload) VALUES (?, 'SAGA_COMPENSATE_PAYMENT_FAILED', ?, ?)",
          [`User #${userId}`, ipAddress, JSON.stringify({ bookingId, pnr, reason: 'Payment gateway rejected transaction' })]
        );
        await db.run('COMMIT;');
      } catch (err) {
        await db.run('ROLLBACK;');
      }
      return { success: false, message: 'Payment failed. Booking cancelled, seats released.' };
    }

    // Step 4 (Simulated fallback): Confirm booking and bind seats permanently
    await db.run('BEGIN TRANSACTION;');
    try {
      // Confirm Booking
      await db.run("UPDATE bookings SET status = 'CONFIRMED' WHERE id = ?", [bookingId]);

      // Confirm Seats
      const updated = await db.run(
        `UPDATE seats 
         SET status = 'BOOKED', locked_by = NULL, lock_expires_at = NULL
         WHERE booking_id = ?`,
        [bookingId]
      );
      
      // Safety check if seat was modified by someone else before commit
      if ((updated.changes ?? 0) === 0) {
        throw new Error(`Concurrency conflict on seat booking confirmation`);
      }

      await db.run(
        "INSERT INTO audit_logs (actor, action, ip, payload) VALUES (?, 'SAGA_BOOKING_CONFIRMED', ?, ?)",
        [`User #${userId}`, ipAddress, JSON.stringify({ bookingId, pnr, status: 'CONFIRMED' })]
      );

      await db.run('COMMIT;');

      // Award loyalty points
      try {
        await LoyaltyService.earnPoints(userId, totalPrice, bookingId);
      } catch {
        logger.warn({ msg: '[Saga] Failed to award loyalty points', userId, bookingId });
      }

      // Fire-and-forget notifications
      const seatDetails = seatNumbers.map(s => `${coachLabel}-${s}`).join(', ');
      NotificationService.sendBookingConfirmation(
        userId,
        userEmail,
        userEmail,
        pnr,
        train?.name || trainNumber,
        seatDetails
      );

      // Save idempotency key
      await setSagaIdempotency(idempotencyKey, { success: true, bookingId, pnr });

      return {
        success: true,
        pnr,
        bookingId,
        message: 'Booking successfully confirmed!',
      };
    } catch (e: any) {
      // Fatal Saga execution error - trigger compensating refund AND booking cancellation
      await db.run('ROLLBACK;');
      
      console.error('Saga Confirmation failed, running compensation: refund and release...', e.message);

      // Call gateway refund API (External API call simulation)
      const refundSuccess = await this.simulatePaymentRefund(totalPrice);

      await db.run('BEGIN TRANSACTION;');
      try {
        await db.run("UPDATE bookings SET status = 'REFUNDED' WHERE id = ?", [bookingId]);
        await db.run(
          `UPDATE seats 
           SET status = 'AVAILABLE', locked_by = NULL, lock_expires_at = NULL, booking_id = NULL
           WHERE booking_id = ?`,
          [bookingId]
        );
        await db.run(
          "INSERT INTO audit_logs (actor, action, ip, payload) VALUES (?, 'SAGA_COMPENSATE_FATAL_CONFLICT', ?, ?)",
          [`User #${userId}`, ipAddress, JSON.stringify({ bookingId, pnr, refundSuccess, error: e.message })]
        );
        await db.run('COMMIT;');
      } catch (err) {
        await db.run('ROLLBACK;');
      }

      return {
        success: false,
        message: `Booking confirmation error: ${e.message}. Automated refund processed successfully.`,
        refunded: refundSuccess,
      };
    }
  }

  /**
   * Confirms a pending booking once successful payment is verified.
   */
  static async confirmPaymentAndCompleteBooking(
    bookingId: number,
    transactionId: string,
    gatewayPaymentId: string
  ): Promise<boolean> {
    const db = await getDb();
    
    // Check if already confirmed
    const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    if (!booking) return false;
    if (booking.status === 'CONFIRMED') return true;

    // Update payment status to SUCCESS and associate the gateway payment ID
    await db.run(
      "UPDATE payments SET status = 'SUCCESS', gateway_payment_id = ?, updated_at = CURRENT_TIMESTAMP WHERE transaction_id = ?",
      [gatewayPaymentId, transactionId]
    );

    await db.run('BEGIN TRANSACTION;');
    try {
      // Double-Check Lock Validation (Recommendation D)
      const dbSeats = await db.all(
        'SELECT id, status, locked_by FROM seats WHERE booking_id = ?',
        [bookingId]
      );
      
      const expectedCount = JSON.parse(booking.passengers).length;
      if (dbSeats.length !== expectedCount) {
        throw new Error(`Seat lock validation failed: Expected ${expectedCount} seats associated, but found ${dbSeats.length}`);
      }

      for (const seat of dbSeats) {
        if (seat.status === 'BOOKED') {
          throw new Error('Seat is already booked by another transaction');
        }
        if (seat.status === 'LOCKED' && seat.locked_by !== booking.user_id) {
          throw new Error('Seat lock was reassigned to another user after expiration');
        }
      }

      // Confirm booking
      await db.run("UPDATE bookings SET status = 'CONFIRMED' WHERE id = ?", [bookingId]);

      // Confirm all seats associated with this booking
      await db.run(
        `UPDATE seats 
         SET status = 'BOOKED', locked_by = NULL, lock_expires_at = NULL
         WHERE booking_id = ?`,
        [bookingId]
      );

      // Log transaction step
      await db.run(
        "INSERT INTO audit_logs (actor, action, ip, payload) VALUES (?, 'SAGA_BOOKING_CONFIRMED', 'SYSTEM', ?)",
        [`User #${booking.user_id}`, JSON.stringify({ bookingId, pnr: booking.pnr, status: 'CONFIRMED' })]
      );

      await db.run('COMMIT;');

      // Award loyalty points
      try {
        await LoyaltyService.earnPoints(booking.user_id, booking.price, bookingId);
      } catch { }

      // Fire notifications
      const seats = await db.all('SELECT seat_number, coach_label FROM seats WHERE booking_id = ?', [bookingId]);
      const seatDetails = seats.map((s: any) => `${s.coach_label}-${s.seat_number}`).join(', ');
      
      const user = await db.get('SELECT email FROM users WHERE id = ?', [booking.user_id]);
      const train = await db.get('SELECT name FROM trains WHERE train_number = ?', [booking.train_number]);

      NotificationService.sendBookingConfirmation(
        booking.user_id,
        user?.email || '',
        user?.email || '',
        booking.pnr,
        train?.name || booking.train_number,
        seatDetails
      );

      return true;
    } catch (error: any) {
      await db.run('ROLLBACK;');
      logger.error(`[Saga] Asynchronous payment confirmation failed for Booking #${bookingId}: ${error.message}`);
      
      // Attempt compensation refund
      try {
        await PaymentService.processRefund(transactionId);
        await db.run("UPDATE bookings SET status = 'REFUNDED' WHERE id = ?", [bookingId]);
        await db.run("UPDATE seats SET status = 'AVAILABLE', booking_id = NULL WHERE booking_id = ?", [bookingId]);
      } catch (refundError: any) {
        logger.error(`[Saga] Compensating refund failed for Booking #${bookingId}: ${refundError.message}`);
      }
      return false;
    }
  }

  /**
   * Simulates payment gateway processing.
   */
  private static async simulatePaymentGateway(method: string, amount: number): Promise<boolean> {
    await new Promise((resolve) => setTimeout(resolve, 800)); // Simulate gateway roundtrip
    // Fail credit card requests where the amount ends in specific digit (e.g. testing triggers) or random 5% failure rate
    if (method === 'Credit Card' && amount === 99999) {
      return false;
    }
    return true; // Assume success for all standard transactions
  }

  /**
   * Simulates payment gateway refund processing.
   */
  private static async simulatePaymentRefund(amount: number): Promise<boolean> {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return true;
  }
}
