import { Router, Response, NextFunction, Request } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { getDb } from '../config/db';
import { validate } from '../middleware/validate';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { PaymentService } from '../services/payment.service';
import { BookingSagaOrchestrator } from '../services/saga.service';
import { NotificationService } from '../services/notification.service';
import { cache, CACHE_TTL } from '../services/cache.service';

const router = Router();

// Validation Schemas
const initiatePaymentSchema = {
  body: z.object({
    bookingId: z.number().int().positive(),
    amount: z.number().positive(),
    paymentMethod: z.enum(['UPI', 'Credit Card', 'Debit Card', 'Net Banking']),
    idempotencyKey: z.string().min(10).optional(),
  }),
};

const verifyPaymentSchema = {
  body: z.object({
    transactionId: z.string().min(5),
  }),
};

const refundSchema = {
  body: z.object({
    transactionId: z.string().min(5),
    amount: z.number().positive().optional(),
  }),
};

const paymentIdSchema = {
  params: z.object({
    transactionId: z.string(),
  }),
};

const paginationSchema = {
  query: z.object({
    limit: z.string().optional(),
    offset: z.string().optional(),
  }),
};

// GET Available Payment Methods (Cached, Public)
router.get('/methods', async (req: any, res: Response, next: NextFunction): Promise<void> => {
  const cacheKey = 'payment:methods';
  const cached = await cache.get<any>(cacheKey);
  if (cached) {
    res.status(200).json({ status: 'success', data: cached, source: 'cache' });
    return;
  }

  const data = {
    methods: [
      { id: 'upi', name: 'UPI (GPay / PhonePe / BHIM)', type: 'UPI', icon: '⚡' },
      { id: 'cc', name: 'Credit Card (Visa / MasterCard / RuPay)', type: 'CARD', icon: '💳' },
      { id: 'dc', name: 'Debit Card (Visa / MasterCard / RuPay)', type: 'CARD', icon: '💳' },
      { id: 'nb', name: 'Net Banking (All Major Banks)', type: 'NETBANKING', icon: '🏦' },
    ],
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || null,
    pciCompliance: 'PCI DSS v4.0 Baseline Compliant - Card data tokenized at edge',
  };
  await cache.set(cacheKey, data, CACHE_TTL.PAYMENT_METHODS);

  res.status(200).json({ status: 'success', data, source: 'database' });
});

// POST Initiate Payment
router.post('/initiate', authenticate, validate(initiatePaymentSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const { bookingId, amount, paymentMethod, idempotencyKey } = req.body;

  try {
    const result = await PaymentService.initiatePayment(
      req.user.id,
      bookingId,
      amount,
      paymentMethod,
      idempotencyKey
    );

    res.status(result.success ? 200 : 400).json({
      status: result.success ? 'success' : 'error',
      message: result.message,
      data: result.success ? {
        paymentId: result.paymentId,
        transactionId: result.transactionId,
      } : undefined,
    });
  } catch (error) {
    next(error);
  }
});

// POST Verify / Confirm Payment
router.post('/verify', authenticate, validate(verifyPaymentSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const { transactionId } = req.body;

  try {
    const result = await PaymentService.verifyPayment(transactionId);

    if (result.success) {
      const payment = await PaymentService.getPaymentStatus(transactionId);
      if (payment) {
        await BookingSagaOrchestrator.confirmPaymentAndCompleteBooking(
          payment.booking_id,
          transactionId,
          payment.gateway_payment_id || transactionId
        );

        await NotificationService.sendPaymentReceipt(
          req.user.id,
          req.user.email,
          payment.amount,
          transactionId,
          'SUCCESS'
        );
      }
    }

    res.status(result.success ? 200 : 400).json({
      status: result.success ? 'success' : 'error',
      message: result.message,
      data: result.success ? {
        paymentId: result.paymentId,
        transactionId: result.transactionId,
      } : undefined,
    });
  } catch (error) {
    next(error);
  }
});

// POST Razorpay webhook handler
router.post('/webhook', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const signature = req.headers['x-razorpay-signature'] as string;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (webhookSecret && signature) {
    const shasum = crypto.createHmac('sha256', webhookSecret);
    shasum.update(JSON.stringify(req.body));
    const digest = shasum.digest('hex');
    if (digest !== signature) {
      res.status(400).json({ status: 'error', message: 'Signature verification failed' });
      return;
    }
  }

  const { event, payload } = req.body;

  if (event === 'payment.captured') {
    try {
      const paymentEntity = payload.payment.entity;
      const orderId = paymentEntity.order_id;
      const paymentId = paymentEntity.id;

      const payment = await PaymentService.getPaymentStatus(orderId);
      if (payment) {
        await BookingSagaOrchestrator.confirmPaymentAndCompleteBooking(
          payment.booking_id,
          orderId,
          paymentId
        );
      }
    } catch (error) {
      next(error);
      return;
    }
  }

  res.status(200).json({ status: 'success' });
});

// POST Process Refund
router.post('/refund', authenticate, validate(refundSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const { transactionId, amount } = req.body;

  try {
    const result = await PaymentService.processRefund(transactionId, amount);

    if (result.success) {
      await NotificationService.sendPaymentReceipt(
        req.user.id,
        req.user.email,
        amount || 0,
        transactionId,
        'REFUNDED'
      );
    }

    res.status(result.success ? 200 : 400).json({
      status: result.success ? 'success' : 'error',
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
});

// GET Payment Status
router.get('/status/:transactionId', authenticate, validate(paymentIdSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const { transactionId } = req.params;

  try {
    const payment = await PaymentService.getPaymentStatus(transactionId);

    if (!payment) {
      res.status(404).json({ status: 'error', message: 'Payment not found' });
      return;
    }

    if (payment.user_id !== req.user.id && req.user.role !== 'Admin' && req.user.role !== 'Super Admin') {
      res.status(403).json({ status: 'error', message: 'Access Denied' });
      return;
    }

    res.status(200).json({
      status: 'success',
      data: {
        transactionId: payment.transaction_id,
        bookingId: payment.booking_id,
        pnr: payment.pnr,
        amount: payment.amount,
        paymentMethod: payment.payment_method,
        status: payment.status,
        bookingStatus: payment.booking_status,
        createdAt: payment.created_at,
        updatedAt: payment.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET Payment History
router.get('/history', authenticate, validate(paginationSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;

  try {
    const history = await PaymentService.getPaymentHistory(req.user.id);

    res.status(200).json({
      status: 'success',
      data: history.map((p: any) => ({
        transactionId: p.transaction_id,
        bookingId: p.booking_id,
        pnr: p.pnr,
        amount: p.amount,
        paymentMethod: p.payment_method,
        status: p.status,
        createdAt: p.created_at,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// POST Wallet top-up
router.post('/wallet/topup', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const { amount } = req.body;
  if (!amount || amount <= 0) {
    res.status(400).json({ status: 'error', message: 'Valid amount required' });
    return;
  }
  const db = await getDb();
  try {
    const wallet = await db.get('SELECT * FROM wallets WHERE user_id = $1', [req.user.id]);
    if (!wallet) {
      await db.run('INSERT INTO wallets (user_id, balance) VALUES ($1, $2)', [req.user.id, amount]);
      await db.run(
        'INSERT INTO wallet_transactions (wallet_id, type, amount, description) VALUES ((SELECT id FROM wallets WHERE user_id = $1), $2, $3, $4)',
        [req.user.id, 'CREDIT', amount, 'Wallet top-up']
      );
    } else {
      await db.run('UPDATE wallets SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [amount, req.user.id]);
      await db.run(
        'INSERT INTO wallet_transactions (wallet_id, type, amount, description) VALUES ($1, $2, $3, $4)',
        [wallet.id, 'CREDIT', amount, 'Wallet top-up']
      );
    }
    const updated = await db.get('SELECT balance FROM wallets WHERE user_id = $1', [req.user.id]);
    res.status(200).json({ status: 'success', data: { balance: updated?.balance || amount } });
  } catch (error) {
    next(error);
  }
});

// GET Wallet balance + transactions
router.get('/wallet', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const db = await getDb();
  try {
    const wallet = await db.get('SELECT * FROM wallets WHERE user_id = $1', [req.user.id]);
    if (!wallet) {
      res.status(200).json({ status: 'success', data: { balance: 0, transactions: [] } });
      return;
    }
    const transactions = await db.all(
      'SELECT * FROM wallet_transactions WHERE wallet_id = $1 ORDER BY created_at DESC LIMIT 50',
      [wallet.id]
    );
    res.status(200).json({ status: 'success', data: { balance: wallet.balance, transactions } });
  } catch (error) {
    next(error);
  }
});

// POST Validate & apply coupon
router.post('/coupon/apply', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const { code, cartValue } = req.body;
  if (!code) {
    res.status(400).json({ status: 'error', message: 'Coupon code required' });
    return;
  }
  const db = await getDb();
  try {
    const coupon = await db.get(
      "SELECT * FROM coupons WHERE code = $1 AND status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)",
      [code.toUpperCase()]
    );
    if (!coupon) {
      res.status(404).json({ status: 'error', message: 'Invalid or expired coupon code' });
      return;
    }
    if (coupon.used_count >= coupon.usage_limit) {
      res.status(400).json({ status: 'error', message: 'Coupon usage limit exhausted' });
      return;
    }
    if ((cartValue || 0) < coupon.min_cart_value) {
      res.status(400).json({ status: 'error', message: `Minimum cart value of ₹${coupon.min_cart_value} required` });
      return;
    }

    let discount = 0;
    if (coupon.discount_percent > 0) {
      discount = Math.round((cartValue || 0) * coupon.discount_percent / 100);
      if (coupon.discount_max_amount > 0 && discount > coupon.discount_max_amount) {
        discount = coupon.discount_max_amount;
      }
    } else {
      discount = coupon.discount_max_amount;
    }

    res.status(200).json({
      status: 'success',
      data: {
        code: coupon.code,
        discountPercent: coupon.discount_percent,
        discountAmount: discount,
        originalTotal: cartValue || 0,
        discountedTotal: Math.max(0, (cartValue || 0) - discount),
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
