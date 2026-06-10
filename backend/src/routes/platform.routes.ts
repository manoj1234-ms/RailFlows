import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { PlatformTicketService } from '../services/platform-ticket.service';

const router = Router();

const platformTicketSchema = {
  body: z.object({
    stationCode: z.string().min(3).max(5),
    passengerName: z.string().min(2),
    passengerAge: z.number().int().min(1).max(120),
  }),
};

const unreservedSchema = {
  body: z.object({
    fromStation: z.string().min(3).max(5),
    toStation: z.string().min(3).max(5),
    passengerName: z.string().min(2),
    passengerAge: z.number().int().min(1).max(120),
  }),
};

const pnrParamSchema = {
  params: z.object({
    pnr: z.string(),
  }),
};

// POST Book platform ticket
router.post('/ticket', authenticate, validate(platformTicketSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const { stationCode, passengerName, passengerAge } = req.body;

  try {
    const result = await PlatformTicketService.bookPlatformTicket(req.user.id, stationCode, passengerName, passengerAge);
    res.status(result.success ? 200 : 400).json({
      status: result.success ? 'success' : 'error',
      message: result.message,
      data: result.success ? { pnr: result.pnr } : undefined,
    });
  } catch (error) {
    next(error);
  }
});

// POST Book unreserved general ticket
router.post('/unreserved', authenticate, validate(unreservedSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const { fromStation, toStation, passengerName, passengerAge } = req.body;

  try {
    const result = await PlatformTicketService.bookUnreservedTicket(req.user.id, fromStation, toStation, passengerName, passengerAge);
    res.status(result.success ? 200 : 400).json({
      status: result.success ? 'success' : 'error',
      message: result.message,
      data: result.success ? { pnr: result.pnr } : undefined,
    });
  } catch (error) {
    next(error);
  }
});

// GET Ticket details by PNR (public - no auth needed like UTS)
router.get('/ticket/:pnr', validate(pnrParamSchema), async (req: any, res: Response, next: NextFunction): Promise<void> => {
  const { pnr } = req.params;

  try {
    const ticket = await PlatformTicketService.getTicketByPNR(pnr);
    if (!ticket) {
      res.status(404).json({ status: 'error', message: 'Ticket not found' });
      return;
    }
    res.status(200).json({
      status: 'success',
      data: {
        pnr: ticket.pnr,
        type: ticket.type,
        fromStation: ticket.from_station,
        fromStationName: ticket.from_station_name,
        toStation: ticket.to_station,
        toStationName: ticket.to_station_name,
        price: ticket.price,
        status: ticket.status,
        passengerName: ticket.passenger_name,
        passengerAge: ticket.passenger_age,
        validFrom: ticket.valid_from,
        validUntil: ticket.valid_until,
        createdAt: ticket.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET User's platform/unreserved tickets
router.get('/my-tickets', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }

  try {
    const tickets = await PlatformTicketService.getUserTickets(req.user.id);
    res.status(200).json({ status: 'success', data: tickets });
  } catch (error) {
    next(error);
  }
});

// POST Cancel a platform/unreserved ticket
router.post('/cancel/:pnr', authenticate, validate(pnrParamSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const { pnr } = req.params;

  try {
    const result = await PlatformTicketService.cancelTicket(pnr, req.user.id);
    res.status(result.success ? 200 : 400).json({
      status: result.success ? 'success' : 'error',
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
