import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { QueueService, queueBanRegistry } from '../services/queue.service';


const router = Router();

// Validation Schemas
const joinQueueSchema = {
  body: z.object({
    deviceFingerprint: z.string().min(8, 'Device fingerprint must be provided for queue security verification'),
  }),
};

const queueStatusSchema = {
  query: z.object({
    token: z.string().min(10),
    deviceFingerprint: z.string().min(8),
  }),
};

// POST Join Virtual Queue
router.post('/join', authenticate, validate(joinQueueSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const { deviceFingerprint } = req.body;
  const userId = req.user.id;
  const ip = req.ip || '127.0.0.1';

  try {
    const queueInfo = await QueueService.getOrCreateQueueToken(userId, ip, deviceFingerprint);
    res.status(200).json({
      status: 'success',
      data: queueInfo,
    });
  } catch (error: any) {
    res.status(403).json({
      status: 'error',
      message: error.message,
    });
  }
});

// GET Poll Queue Status (With anti-tampering verification checks)
router.get('/status', authenticate, validate(queueStatusSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const token = req.query.token as string;
  const deviceFingerprint = req.query.deviceFingerprint as string;
  
  const userId = req.user.id;
  const ip = req.ip || '127.0.0.1';

  try {
    // ANTI-MANIPULATION / TAMPERING SECURITY CHECK:
    // Generate the correct hash for this user's context.
    const expectedToken = QueueService.generateTokenHash(userId, ip, deviceFingerprint);
    
    // If the token provided in the poll doesn't match the expected token for this user/IP/device combo,
    // they are attempting to spoof or hijack a queue position.
    if (token !== expectedToken) {
      console.warn(`[SECURITY WARNING] Queue tampering attempt detected for User #${userId}. Banning...`);
      await QueueService.banUserForTampering(userId);
      res.status(403).json({
        status: 'error',
        message: 'Security Alert: Queue manipulation detected. Your account has been suspended from the queue for 30 minutes.',
        isBanned: true,
      });
      return;
    }

    // Process wait times and retrieve token state
    const queueInfo = await QueueService.getOrCreateQueueToken(userId, ip, deviceFingerprint);
    res.status(200).json({
      status: 'success',
      data: queueInfo,
    });
  } catch (error: any) {
    res.status(400).json({
      status: 'error',
      message: error.message,
    });
  }
});

export default router;
