import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate, AuthenticatedRequest, requireRole } from '../middleware/auth';
import { RefundService } from '../services/refund.service';
import logger from '../utils/logger';

const router = Router();

const initiateSchema = {
  body: z.object({
    bookingId: z.number().int().positive(),
    reason: z.string().min(3).max(500),
  }),
};

const reviewSchema = {
  body: z.object({
    action: z.enum(['APPROVE', 'REJECT']),
  }),
};

router.post('/predict', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { bookingId, reason } = req.body;
    if (!bookingId) { res.status(400).json({ status: 'error', message: 'bookingId required' }); return; }
    const prediction = await RefundService.predictRefund(bookingId, req.user!.id, reason || 'Not specified');
    res.status(200).json({ status: 'success', data: prediction });
  } catch (err: any) {
    res.status(400).json({ status: 'error', message: err.message });
  }
});

router.post('/initiate', authenticate, validate(initiateSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await RefundService.initiateRefund(req.body.bookingId, req.user!.id, req.body.reason);
    res.status(result.status === 'PENDING' ? 202 : 200).json({ status: 'success', data: result });
  } catch (err: any) {
    res.status(400).json({ status: 'error', message: err.message });
  }
});

router.get('/status/:bookingId', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await RefundService.getRefundStatus(Number(req.params.bookingId), req.user!.id);
    res.status(200).json({ status: 'success', data: result });
  } catch (err: any) {
    res.status(404).json({ status: 'error', message: err.message });
  }
});

router.post('/webhook', async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { transactionId, status, refundAmount } = req.body;
    if (!transactionId || !status) {
      res.status(400).json({ status: 'error', message: 'transactionId and status required' });
      return;
    }
    logger.info({ msg: '[Refund Webhook] Received', transactionId, status, refundAmount });
    res.status(200).json({ status: 'success', message: 'Webhook acknowledged' });
  } catch (err: any) {
    res.status(400).json({ status: 'error', message: err.message });
  }
});

const adminRouter = Router();
adminRouter.use(authenticate);
adminRouter.use(requireRole(['Admin', 'Super Admin']));

adminRouter.get('/analytics', async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const analytics = await RefundService.getRefundAnalytics();
    res.status(200).json({ status: 'success', data: analytics });
  } catch (error) { next(error); }
});

adminRouter.get('/list', async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const { refunds, total } = await RefundService.getAllRefunds(page, limit);
    res.status(200).json({ status: 'success', data: refunds, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

adminRouter.post('/review/:refundId', validate(reviewSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await RefundService.adminReviewRefund(Number(req.params.refundId), req.user!.id, req.body.action);
    res.status(200).json({ status: 'success', data: result });
  } catch (err: any) {
    res.status(400).json({ status: 'error', message: err.message });
  }
});

adminRouter.post('/retry-gateway/:refundId', async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await RefundService.retryGatewayRefund(Number(req.params.refundId));
    res.status(200).json({ status: 'success', data: result });
  } catch (err: any) {
    res.status(400).json({ status: 'error', message: err.message });
  }
});

export { adminRouter as adminRefundRouter };
export default router;
