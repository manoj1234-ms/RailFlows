import { getDb } from '../config/db';
import { v4 as uuidv4 } from 'uuid';
import { sendRefundEmail } from './email.service';
import { PaymentService } from './payment.service';
import logger from '../utils/logger';

interface RefundPrediction {
  recommendedRefundPct: number;
  processingEtaHours: number;
  riskScore: number;
}

export class RefundService {

  static async predictRefund(bookingId: number, userId: number, reason: string): Promise<RefundPrediction> {
    const db = await getDb();
    const booking = await db.get('SELECT * FROM bookings WHERE id = ? AND user_id = ?', [bookingId, userId]);
    if (!booking) throw new Error('Booking not found');
    return this.computePrediction(db, booking, userId, reason);
  }

  static async initiateRefund(bookingId: number, userId: number, reason: string): Promise<any> {
    const db = await getDb();
    const booking = await db.get('SELECT * FROM bookings WHERE id = ? AND user_id = ?', [bookingId, userId]);
    if (!booking) throw new Error('Booking not found');
    if (booking.status === 'CANCELLED') throw new Error('Booking already cancelled');
    if (booking.status === 'REFUNDED') throw new Error('Booking already refunded');

    const payment = await db.get(
      "SELECT * FROM payments WHERE booking_id = ? AND status = 'SUCCESS'",
      [bookingId]
    );

    const prediction = await this.computePrediction(db, booking, userId, reason);
    const paidAmount = payment ? payment.amount : booking.price;
    const refundAmount = Math.round(paidAmount * prediction.recommendedRefundPct / 100);
    const refundId = uuidv4().slice(0, 12);
    const needsApproval = prediction.riskScore > 0.6;
    const initialStatus = needsApproval ? 'PENDING' : 'APPROVED';

    const result = await db.run(
      `INSERT INTO refunds (booking_id, payment_id, user_id, amount, reason, status, risk_score, processing_eta_hours, refund_pct)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [bookingId, payment?.id || null, userId, refundAmount, reason, initialStatus, prediction.riskScore, prediction.processingEtaHours, prediction.recommendedRefundPct]
    );
    const refundDbId = result.lastID!;

    await db.run(
      "INSERT INTO audit_logs (actor, action, ip, payload) VALUES (?, 'REFUND_INITIATED', ?, ?)",
      [`User #${userId}`, 'SYSTEM', JSON.stringify({ bookingId, refundAmount, reason, riskScore: prediction.riskScore, needsApproval })]
    );

    let finalStatus = initialStatus;
    if (!needsApproval) {
      await this.processGatewayRefund(bookingId, payment, refundAmount, refundDbId);
      finalStatus = 'COMPLETED';
    }

    const user = await db.get<{ email: string }>('SELECT email FROM users WHERE id = ?', [userId]);

    if (needsApproval) {
      logger.info({ msg: '[Refund] Pending approval', bookingId, refundAmount, riskScore: prediction.riskScore, reason });
      if (user?.email) {
        sendRefundEmail(user.email, booking.pnr, refundAmount).catch(() => {});
      }
      return {
        refundId,
        bookingId,
        amount: refundAmount,
        status: 'PENDING',
        riskScore: prediction.riskScore,
        processingEtaHours: prediction.processingEtaHours,
        message: 'Refund request submitted for review. You will be notified once approved.',
      };
    }

    await this.completeRefundActions(db, bookingId, payment, refundDbId, finalStatus, prediction.recommendedRefundPct);
    logger.info({ msg: '[Refund] Completed', bookingId, refundAmount, riskScore: prediction.riskScore, reason });

    if (user?.email) {
      sendRefundEmail(user.email, booking.pnr, refundAmount).catch(() => {});
    }

    return {
      refundId,
      bookingId,
      amount: refundAmount,
      status: finalStatus,
      refundPct: prediction.recommendedRefundPct,
      riskScore: prediction.riskScore,
      processingEtaHours: prediction.processingEtaHours,
      message: `Refund of ₹${refundAmount} (${prediction.recommendedRefundPct}% of paid amount) processed successfully.`,
    };
  }

  static async getRefundStatus(bookingId: number, userId: number): Promise<any> {
    const db = await getDb();
    const refund = await db.get(
      'SELECT * FROM refunds WHERE booking_id = ? AND user_id = ?',
      [bookingId, userId]
    );
    if (!refund) throw new Error('No refund found for this booking');
    return refund;
  }

  static async adminReviewRefund(refundId: number, adminUserId: number, action: 'APPROVE' | 'REJECT'): Promise<any> {
    const db = await getDb();
    const refund = await db.get('SELECT * FROM refunds WHERE id = ?', [refundId]);
    if (!refund) throw new Error('Refund not found');
    if (refund.status !== 'PENDING') throw new Error('Refund is not pending approval');

    if (action === 'REJECT') {
      await db.run(
        "UPDATE refunds SET status = 'REJECTED', approved_by = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?",
        [adminUserId, refundId]
      );
      await db.run(
        "INSERT INTO audit_logs (actor, action, ip, payload) VALUES (?, 'REFUND_REJECTED', ?, ?)",
        [`Admin #${adminUserId}`, 'SYSTEM', JSON.stringify({ refundId })]
      );
      logger.info({ msg: '[Refund] Rejected by admin', refundId, adminUserId });
      return { status: 'REJECTED', message: 'Refund request rejected.' };
    }

    await this.processGatewayRefund(refund.booking_id, null, refund.amount, refundId);
    await this.completeRefundActions(db, refund.booking_id, null, refundId, 'COMPLETED', refund.refund_pct || 90);

    logger.info({ msg: '[Refund] Approved by admin', refundId, adminUserId, amount: refund.amount });
    return { status: 'COMPLETED', amount: refund.amount, message: `Refund of ₹${refund.amount} approved and processed.` };
  }

  static async retryGatewayRefund(refundId: number): Promise<any> {
    const db = await getDb();
    const refund = await db.get('SELECT * FROM refunds WHERE id = ?', [refundId]);
    if (!refund) throw new Error('Refund not found');
    if (refund.status !== 'COMPLETED') throw new Error('Only completed refunds can be retried');

    const retryCount = (refund.gateway_retry_count || 0) + 1;
    if (retryCount > 3) throw new Error('Maximum gateway retry attempts reached');

    const payment = await db.get('SELECT * FROM payments WHERE booking_id = ?', [refund.booking_id]);
    const msg = await this.processGatewayRefund(refund.booking_id, payment, refund.amount, refundId);

    await db.run(
      'UPDATE refunds SET gateway_retry_count = ?, gateway_response = ? WHERE id = ?',
      [retryCount, msg || null, refundId]
    );

    logger.info({ msg: '[Refund] Gateway retry', refundId, retryCount });
    return { success: !!msg, gatewayResponse: msg, retryCount };
  }

  static async getRefundAnalytics(): Promise<any> {
    const db = await getDb();
    const totalRefunds = await db.get(
      "SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total_amount FROM refunds WHERE status = 'COMPLETED'"
    );
    const pendingApproval = await db.get(
      "SELECT COUNT(*) as count FROM refunds WHERE status = 'PENDING'"
    );
    const highRisk = await db.get(
      "SELECT COUNT(*) as count FROM refunds WHERE risk_score > 0.6 AND status != 'REJECTED'"
    );
    const avgRefundPct = await db.get(
      "SELECT COALESCE(AVG(refund_pct), 0) as avg FROM refunds WHERE status = 'COMPLETED'"
    );
    const recentHighRisk = await db.all(
      "SELECT r.*, u.email as user_email FROM refunds r JOIN users u ON r.user_id = u.id WHERE r.risk_score > 0.6 AND r.status = 'PENDING' ORDER BY r.initiated_at DESC LIMIT 20"
    );
    return {
      totalCompleted: totalRefunds?.count ?? 0,
      totalAmount: totalRefunds?.total_amount ?? 0,
      pendingApproval: pendingApproval?.count ?? 0,
      highRiskCount: highRisk?.count ?? 0,
      avgRefundPercentage: Math.round((avgRefundPct?.avg ?? 90) * 100) / 100,
      recentHighRisk,
    };
  }

  static async getAllRefunds(page: number = 1, limit: number = 20): Promise<{ refunds: any[]; total: number }> {
    const db = await getDb();
    const offset = (page - 1) * limit;
    const countResult = await db.get('SELECT COUNT(*) as count FROM refunds');
    const total = countResult?.count ?? 0;
    const refunds = await db.all(
      `SELECT r.*, u.email as user_email, b.pnr
       FROM refunds r
       LEFT JOIN users u ON r.user_id = u.id
       LEFT JOIN bookings b ON r.booking_id = b.id
       ORDER BY r.initiated_at DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return { refunds, total };
  }

  private static async processGatewayRefund(bookingId: number, payment: any, amount: number, refundDbId: number): Promise<string | undefined> {
    if (!payment) return undefined;
    try {
      const gatewayResult = await PaymentService.processRefund(payment.transaction_id, amount);
      if (gatewayResult.success) {
        const db = await getDb();
        await db.run(
          'UPDATE refunds SET gateway_response = ? WHERE id = ?',
          [gatewayResult.message, refundDbId]
        );
        return gatewayResult.message;
      }
    } catch (err: any) {
      logger.error({ msg: '[Refund] Gateway processing failed', bookingId, error: err.message });
      return `Gateway error: ${err.message}`;
    }
    return undefined;
  }

  private static async completeRefundActions(db: any, bookingId: number, payment: any, refundDbId: number, status: string, refundPct: number): Promise<void> {
    await db.run(
      "UPDATE refunds SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?",
      [status, refundDbId]
    );
    await db.run(
      "UPDATE bookings SET status = 'REFUNDED' WHERE id = ?",
      [bookingId]
    );
    if (payment) {
      const isFull = refundPct >= 100;
      await db.run(
        "UPDATE payments SET status = ? WHERE booking_id = ?",
        [isFull ? 'REFUNDED' : 'PARTIALLY_REFUNDED', bookingId]
      );
    }
    await db.run(
      `UPDATE seats SET status = 'AVAILABLE', locked_by = NULL, lock_expires_at = NULL, booking_id = NULL
       WHERE booking_id = ?`,
      [bookingId]
    );
    await db.run(
      "INSERT INTO audit_logs (actor, action, ip, payload) VALUES (?, 'REFUND_COMPLETED', ?, ?)",
      ['SYSTEM', 'SYSTEM', JSON.stringify({ bookingId, refundAmount: payment?.amount, refundPct })]
    );
  }

  private static async computePrediction(db: any, booking: any, userId: number, reason: string): Promise<RefundPrediction> {
    const hoursUntilDeparture = RefundService.getHoursUntilDeparture(booking.created_at);
    const basePct = RefundService.calculateBaseRefundPct(hoursUntilDeparture);

    const userRefundCount = await db.get(
      "SELECT COUNT(*) as count FROM refunds WHERE user_id = ? AND status = 'COMPLETED'",
      [userId]
    );
    const totalUserRefunds = userRefundCount?.count ?? 0;

    const recentRefundCount = await db.get(
      "SELECT COUNT(*) as count FROM refunds WHERE user_id = ? AND created_at > datetime('now', '-30 days')",
      [userId]
    );
    const recentRefunds = recentRefundCount?.count ?? 0;

    const riskScore = RefundService.calculateRiskScore(recentRefunds, totalUserRefunds, hoursUntilDeparture, reason);
    const etaHours = riskScore > 0.6 ? 48 : riskScore > 0.3 ? 24 : 6;

    return {
      recommendedRefundPct: basePct,
      processingEtaHours: etaHours,
      riskScore: Math.round(riskScore * 100) / 100,
    };
  }

  private static calculateBaseRefundPct(hoursUntilDeparture: number): number {
    if (hoursUntilDeparture > 48) return 90;
    if (hoursUntilDeparture > 24) return 75;
    if (hoursUntilDeparture > 12) return 50;
    if (hoursUntilDeparture > 4) return 25;
    return 10;
  }

  private static calculateRiskScore(recentRefunds: number, totalRefunds: number, hoursUntilDeparture: number, reason: string): number {
    let score = 0;
    if (recentRefunds >= 3) score += 0.3;
    else if (recentRefunds >= 1) score += 0.1;
    if (totalRefunds >= 10) score += 0.2;
    else if (totalRefunds >= 5) score += 0.1;
    if (hoursUntilDeparture > 168) score += 0.15;
    if (hoursUntilDeparture < 1) score += 0.1;
    const highRiskReasons = ['change of mind', 'not required', 'better offer', 'mistake', 'wrong booking'];
    if (highRiskReasons.some(r => reason.toLowerCase().includes(r))) score += 0.15;
    const validReasons = ['medical emergency', 'train cancelled', 'death in family', 'government order', 'accident'];
    if (validReasons.some(r => reason.toLowerCase().includes(r))) score -= 0.2;
    const userHistory = ['frequent', 'repeated', 'habitual', 'multiple'];
    if (userHistory.some(r => reason.toLowerCase().includes(r))) score += 0.1;
    return Math.max(0, Math.min(1, score));
  }

  private static getHoursUntilDeparture(createdAt: string): number {
    const created = new Date(createdAt).getTime();
    const now = Date.now();
    return Math.max(0, (now - created) / (1000 * 60 * 60));
  }
}
