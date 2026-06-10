import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { StationService } from '../services/station.service';

const router = Router();

const autocompleteSchema = {
  query: z.object({
    q: z.string().min(1),
    limit: z.string().optional(),
  }),
};

const stationCodeSchema = {
  params: z.object({
    code: z.string().min(3).max(5),
  }),
};

const nearbySchema = {
  query: z.object({
    lat: z.string(),
    lng: z.string(),
    radius: z.string().optional(),
  }),
};

// GET Autocomplete stations
router.get('/autocomplete', validate(autocompleteSchema), async (req: any, res: Response, next: NextFunction): Promise<void> => {
  const query = req.query.q as string;
  const limit = parseInt(req.query.limit as string) || 10;

  try {
    const stations = await StationService.autocomplete(query, limit);
    res.status(200).json({ status: 'success', data: stations });
  } catch (error) {
    next(error);
  }
});

// GET Nearby stations (must be before /:code to avoid route conflict)
router.get('/nearby', validate(nearbySchema), async (req: any, res: Response, next: NextFunction): Promise<void> => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const radius = parseInt(req.query.radius as string) || 50;

  try {
    const stations = await StationService.getNearby(lat, lng, radius);
    res.status(200).json({ status: 'success', data: stations });
  } catch (error) {
    next(error);
  }
});

// GET Station details by code
router.get('/:code', validate(stationCodeSchema), async (req: any, res: Response, next: NextFunction): Promise<void> => {
  const { code } = req.params;

  try {
    const station = await StationService.getByCode(code.toUpperCase());
    if (!station) {
      res.status(404).json({ status: 'error', message: 'Station not found' });
      return;
    }
    res.status(200).json({ status: 'success', data: station });
  } catch (error) {
    next(error);
  }
});

// GET All stations (paginated)
router.get('/', async (req: any, res: Response, next: NextFunction): Promise<void> => {
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;

  try {
    const stations = await StationService.list(limit, offset);
    res.status(200).json({ status: 'success', data: stations });
  } catch (error) {
    next(error);
  }
});

export default router;
