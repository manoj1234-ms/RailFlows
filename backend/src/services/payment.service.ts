import crypto from 'crypto';
import { getDb } from '../config/db';
import { isRedisReady, getRedis } from '../config/redis';
import { getRazorpay } from '../config/razorpay';
import logger from '../utils/logger';

export interface PaymentResult {
  success: boolean;
  paymentId?: string;
  transactionId?: string;
  message: string;
}

const IDEMPOTENCY_TTL = 24 * 60 * 60;

async function getIdempotency(key: string): Promise<PaymentResult | null> {
  if (isRedisReady()) {
    const redis = getRedis();
    const cached = await redis.get(`idempotency:${key}`);
    if (cached) return JSON.parse(cached);
  }
  return null;
}

async function setIdempotency(key: string, result: PaymentResult): Promise<void> {
  if (isRedisReady()) {
    const redis = getRedis();
    await redis.set(`idempotency:${key}`, JSON.stringify(result), 'EX', IDEMPOTENCY_TTL);
  }
}

export class PaymentService {
  /**
   * Generates a unique transaction ID.
   */
  private static generateTransactionId(): string {
    return 'TXN' + Date.now() + crypto.randomBytes(4).toString('hex').toUpperCase();
  }

  /**
   * Initiate a payment for a booking.
   */
  static async initiatePayment(
    userId: number,
    bookingId: number,
    amount: number,
    paymentMethod: string,
    idempotencyKey?: string
  ): Promise<PaymentResult> {
    if (idempotencyKey) {
      const cached = await getIdempotency(idempotencyKey);
      if (cached) return cached;
    }

    const db = await getDb();
    let transactionId = this.generateTransactionId();

    const razorpay = getRazorpay();
    if (razorpay) {
      try {
        const order = await razorpay.orders.create({
          amount: Math.round(amount * 100), // in paise (e.g. ₹10 -> 1000 paise)
          currency: 'INR',
          receipt: `rcpt_${bookingId}_${Date.now()}`,
        });
        transactionId = order.id;
        logger.info(`[Payment Service] Razorpay Order created: ${transactionId} for ₹${amount}`);
      } catch (error: any) {
        logger.error(`[Payment Service] Razorpay Order creation failed: ${error.message}`);
        return { success: false, message: `Razorpay Order creation failed: ${error.message}` };
      }
    } else {
      logger.info(`[Payment Service] Initiating simulated payment: ${transactionId} for ₹${amount}`);
    }

    try {
      await db.run(
        `INSERT INTO payments (user_id, booking_id, transaction_id, amount, payment_method, status, idempotency_key)
         VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`,
        [userId, bookingId, transactionId, amount, paymentMethod, idempotencyKey || null]
      );

      const result: PaymentResult = {
        success: true,
        paymentId: transactionId,
        transactionId,
        message: razorpay 
          ? `Razorpay payment initiated.` 
          : `Payment initiated via ${paymentMethod}. Complete verification to confirm.`,
      };

      if (idempotencyKey) {
        await setIdempotency(idempotencyKey, result);
      }

      return result;
    } catch (error: any) {
      logger.error(`[Payment Service] Database insertion failed: ${error.message}`);
      return { success: false, message: `Payment initiation failed: ${error.message}` };
    }
  }

  /**
   * Verify and confirm a payment (simulates gateway callback/redirect or fetches order state).
   */
  static async verifyPayment(transactionId: string): Promise<PaymentResult> {
    const db = await getDb();
    const payment = await db.get(
      'SELECT * FROM payments WHERE transaction_id = ?',
      [transactionId]
    );

    if (!payment) {
      return { success: false, message: 'Payment transaction not found' };
    }

    if (payment.status !== 'PENDING') {
      return {
        success: payment.status === 'SUCCESS',
        paymentId: transactionId,
        transactionId,
        message: `Payment already ${payment.status.toLowerCase()}`,
      };
    }

    let success = false;
    let newStatus = 'FAILED';

    const razorpay = getRazorpay();
    if (razorpay && transactionId.startsWith('order_')) {
      try {
        const order = await razorpay.orders.fetch(transactionId);
        success = order.status === 'paid';
        newStatus = success ? 'SUCCESS' : 'FAILED';
      } catch (error: any) {
        logger.error(`[Payment Service] Razorpay order fetch failed for ${transactionId}: ${error.message}`);
        return { success: false, message: `Razorpay verification error: ${error.message}` };
      }
    } else {
      // Simulate gateway verification (800ms delay)
      await new Promise((resolve) => setTimeout(resolve, 800));
      success = payment.amount !== 99999;
      newStatus = success ? 'SUCCESS' : 'FAILED';
    }

    await db.run(
      "UPDATE payments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE transaction_id = ?",
      [newStatus, transactionId]
    );

    await db.run(
      "INSERT INTO audit_logs (actor, action, ip, payload) VALUES (?, 'PAYMENT_VERIFIED', 'SYSTEM', ?)",
      [`User #${payment.user_id}`, JSON.stringify({ transactionId, status: newStatus, amount: payment.amount })]
    );

    logger.info(`[Payment Service] Payment ${transactionId} -> ${newStatus}`);

    return {
      success,
      paymentId: transactionId,
      transactionId,
      message: success ? 'Payment successful' : 'Payment failed',
    };
  }

  /**
   * Process a full or partial refund.
   */
  static async processRefund(transactionId: string, amount?: number): Promise<PaymentResult> {
    const db = await getDb();
    const payment = await db.get(
      'SELECT * FROM payments WHERE transaction_id = ?',
      [transactionId]
    );

    if (!payment) {
      return { success: false, message: 'Payment transaction not found' };
    }

    if (payment.status === 'REFUNDED') {
      return { success: false, message: 'Payment already refunded' };
    }

    if (payment.status !== 'SUCCESS') {
      return { success: false, message: 'Only successful payments can be refunded' };
    }

    const refundAmount = amount || payment.amount;
    const isPartial = refundAmount < payment.amount;
    const newStatus = isPartial ? 'PARTIALLY_REFUNDED' : 'REFUNDED';

    const razorpay = getRazorpay();
    if (razorpay && payment.gateway_payment_id) {
      try {
        await razorpay.payments.refund(payment.gateway_payment_id, {
          amount: Math.round(refundAmount * 100),
        });
        logger.info(`[Payment Service] Razorpay refund successful for payment ${payment.gateway_payment_id} amount: ₹${refundAmount}`);
      } catch (error: any) {
        logger.error(`[Payment Service] Razorpay refund failed for ${payment.gateway_payment_id}: ${error.message}`);
        return { success: false, message: `Razorpay refund failed: ${error.message}` };
      }
    } else {
      // Simulate gateway refund (400ms delay)
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    await db.run(
      "UPDATE payments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE transaction_id = ?",
      [newStatus, transactionId]
    );

    await db.run(
      "INSERT INTO audit_logs (actor, action, ip, payload) VALUES (?, 'PAYMENT_REFUND', 'SYSTEM', ?)",
      [`Payment #${transactionId}`, JSON.stringify({ transactionId, refundAmount, status: newStatus })]
    );

    logger.info(`[Payment Service] Refund processed for ${transactionId}: ₹${refundAmount} (${newStatus})`);

    return {
      success: true,
      paymentId: transactionId,
      transactionId,
      message: `Refund of ₹${refundAmount} processed successfully`,
    };
  }

  /**
   * Get payment status and details.
   */
  static async getPaymentStatus(transactionId: string): Promise<any> {
    const db = await getDb();
    return db.get(
      `SELECT p.*, b.pnr, b.status as booking_status
       FROM payments p
       LEFT JOIN bookings b ON p.booking_id = b.id
       WHERE p.transaction_id = ?`,
      [transactionId]
    );
  }

  /**
   * Get payment history for a user.
   */
  static async getPaymentHistory(userId: number): Promise<any[]> {
    const db = await getDb();
    return db.all(
      `SELECT p.*, b.pnr
       FROM payments p
       LEFT JOIN bookings b ON p.booking_id = b.id
       WHERE p.user_id = ?
       ORDER BY p.created_at DESC`,
      [userId]
    );
  }

  /**
   * Get all payments (admin).
   */
  static async getAllPayments(limit = 50, offset = 0): Promise<any[]> {
    const db = await getDb();
    return db.all(
      `SELECT p.*, u.email as user_email, b.pnr
       FROM payments p
       LEFT JOIN users u ON p.user_id = u.id
       LEFT JOIN bookings b ON p.booking_id = b.id
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
  }
}
