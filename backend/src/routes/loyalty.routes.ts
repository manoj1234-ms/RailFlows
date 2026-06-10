import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { LoyaltyService } from '../services/loyalty.service';

const router = Router();

router.use(authenticate);

const redeemSchema = {
  body: z.object({
    points: z.number().int().positive(),
  }),
};

router.get('/points', async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const account = await LoyaltyService.getOrCreateAccount(req.user!.id);
    res.status(200).json({ status: 'success', data: account });
  } catch (error) {
    next(error);
  }
});

router.get('/history', async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const { transactions, total } = await LoyaltyService.getTransactionHistory(req.user!.id, page, limit);
    res.status(200).json({
      status: 'success',
      data: transactions,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/redeem', validate(redeemSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await LoyaltyService.redeemPoints(req.user!.id, req.body.points);
    res.status(result.success ? 200 : 400).json({ status: result.success ? 'success' : 'error', data: result });
  } catch (error) {
    next(error);
  }
});

router.get('/predict', async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const prediction = await LoyaltyService.predictPoints(req.user!.id);
    res.status(200).json({ status: 'success', data: prediction });
  } catch (error) {
    next(error);
  }
});

router.get('/recommendations', async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const recommendations = await LoyaltyService.getRecommendations(req.user!.id);
    res.status(200).json({ status: 'success', data: recommendations });
  } catch (error) {
    next(error);
  }
});

router.get('/rewards', async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rewards = await LoyaltyService.getAvailableRewards(req.user!.id);
    res.status(200).json({ status: 'success', data: rewards });
  } catch (error) {
    next(error);
  }
});

export default router;
