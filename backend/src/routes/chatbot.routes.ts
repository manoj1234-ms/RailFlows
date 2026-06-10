import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate, AuthenticatedRequest, requireRole } from '../middleware/auth';
import { ChatbotService } from '../services/chatbot.service';

const router = Router();

const askSchema = {
  body: z.object({
    message: z.string().min(1).max(1000),
  }),
};

const trainSchema = {
  body: z.object({
    intent: z.string().min(1),
    pattern: z.string().min(1),
    response: z.string().min(1),
    contextRequired: z.boolean().optional(),
  }),
};

router.post('/ask', validate(askSchema), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user?.id;
    const result = await ChatbotService.getResponse(req.body.message, userId);
    res.status(200).json({ status: 'success', data: result });
  } catch (error) {
    next(error);
  }
});

router.post('/ask/authenticated', authenticate, validate(askSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await ChatbotService.getResponse(req.body.message, req.user!.id);
    res.status(200).json({ status: 'success', data: result });
  } catch (error) {
    next(error);
  }
});

router.post('/train', authenticate, requireRole(['Admin', 'Super Admin']), validate(trainSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await ChatbotService.addTrainingData(req.body.intent, req.body.pattern, req.body.response, req.body.contextRequired);
    res.status(200).json({ status: 'success', message: 'Training data added' });
  } catch (error) {
    next(error);
  }
});

export default router;
