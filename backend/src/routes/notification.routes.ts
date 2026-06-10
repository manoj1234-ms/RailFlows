import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate, AuthenticatedRequest, requireRole } from '../middleware/auth';
import { NotificationService } from '../services/notification.service';

const router = Router();

const sendNotificationSchema = {
  body: z.object({
    type: z.enum(['EMAIL', 'SMS', 'PUSH']),
    channel: z.string().min(3),
    subject: z.string().optional(),
    body: z.string().min(1),
    referenceType: z.string().optional(),
    referenceId: z.string().optional(),
  }),
};

const updatePreferencesSchema = {
  body: z.object({
    emailEnabled: z.boolean().optional(),
    smsEnabled: z.boolean().optional(),
    pushEnabled: z.boolean().optional(),
    bookingUpdates: z.boolean().optional(),
    paymentUpdates: z.boolean().optional(),
    promotional: z.boolean().optional(),
  }),
};

const paginationSchema = {
  query: z.object({
    limit: z.string().optional(),
    offset: z.string().optional(),
  }),
};

// POST Send a notification
router.post('/send', authenticate, validate(sendNotificationSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const { type, channel, subject, body, referenceType, referenceId } = req.body;

  try {
    const sent = await NotificationService.send({
      userId: req.user.id,
      type,
      channel,
      subject,
      body,
      referenceType,
      referenceId,
    });

    res.status(sent ? 200 : 400).json({
      status: sent ? 'success' : 'error',
      message: sent ? 'Notification sent successfully' : 'Notification delivery failed or disabled in preferences',
    });
  } catch (error) {
    next(error);
  }
});

// GET Notification history
router.get('/history', authenticate, validate(paginationSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;

  try {
    const history = await NotificationService.getHistory(req.user.id, limit, offset);

    res.status(200).json({
      status: 'success',
      data: history.map((n: any) => ({
        id: n.id,
        type: n.type,
        channel: n.channel,
        subject: n.subject,
        body: n.body,
        status: n.status,
        referenceType: n.reference_type,
        referenceId: n.reference_id,
        createdAt: n.created_at,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// GET Notification preferences
router.get('/preferences', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }

  try {
    const prefs = await NotificationService.getPreferences(req.user.id);

    res.status(200).json({
      status: 'success',
      data: {
        emailEnabled: prefs.email_enabled === 1,
        smsEnabled: prefs.sms_enabled === 1,
        pushEnabled: prefs.push_enabled === 1,
        bookingUpdates: prefs.booking_updates === 1,
        paymentUpdates: prefs.payment_updates === 1,
        promotional: prefs.promotional === 1,
      },
    });
  } catch (error) {
    next(error);
  }
});

// PUT Update notification preferences
router.put('/preferences', authenticate, validate(updatePreferencesSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }

  try {
    await NotificationService.updatePreferences(req.user.id, req.body);

    res.status(200).json({
      status: 'success',
      message: 'Notification preferences updated',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
