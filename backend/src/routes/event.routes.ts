import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { EventService } from '../services/event.service';

const router = Router();

const eventIdSchema = {
  params: z.object({ id: z.string().transform(Number) }),
};

const lockSeatsSchema = {
  body: z.object({
    eventId: z.number().int().positive(),
    section: z.string(),
    rowLabel: z.string(),
    seatNumbers: z.array(z.number()).min(1).max(10),
  }),
};

const confirmSchema = {
  body: z.object({
    eventId: z.number().int().positive(),
    section: z.string(),
    rowLabel: z.string(),
    seatNumbers: z.array(z.number()).min(1).max(10),
    totalPrice: z.number().positive(),
  }),
};

// GET List events
router.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const category = req.query.category as string | undefined;
  const city = req.query.city as string | undefined;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));

  try {
    const { events, total } = await EventService.listEvents(category, city, page, limit);
    res.status(200).json({
      status: 'success',
      data: events,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
});

// GET Event details
router.get('/:id', validate(eventIdSchema), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const id = parseInt(req.params.id);

  try {
    const event = await EventService.getEvent(id);
    if (!event) {
      res.status(404).json({ status: 'error', message: 'Event not found' });
      return;
    }
    res.status(200).json({ status: 'success', data: event });
  } catch (error) {
    next(error);
  }
});

// GET Seat map for event
router.get('/:id/seats', validate(eventIdSchema), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const id = parseInt(req.params.id);

  try {
    const seats = await EventService.getSeatMap(id);
    res.status(200).json({ status: 'success', data: seats });
  } catch (error) {
    next(error);
  }
});

// POST Lock event seats
router.post('/seats/lock', authenticate, validate(lockSeatsSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const { eventId, section, rowLabel, seatNumbers } = req.body;

  try {
    const result = await EventService.lockSeats(eventId, req.user.id, section, rowLabel, seatNumbers);
    res.status(result.success ? 200 : 409).json(result);
  } catch (error) {
    next(error);
  }
});

// POST Confirm event booking
router.post('/book', authenticate, validate(confirmSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const { eventId, section, rowLabel, seatNumbers, totalPrice } = req.body;

  try {
    const result = await EventService.confirmBooking(eventId, req.user.id, section, rowLabel, seatNumbers, totalPrice);
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
