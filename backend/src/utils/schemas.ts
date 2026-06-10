import { z } from 'zod';

export const pnrParam = z.object({ pnr: z.string().min(1) });
export const trainIdParam = z.object({ id: z.string().min(1) });
export const stationCodeParam = z.object({ code: z.string().min(3).max(5) });
export const paginationQuery = z.object({
  limit: z.string().optional().default('50'),
  offset: z.string().optional().default('0'),
});
export const fromToQuery = z.object({
  from: z.string().min(2),
  to: z.string().min(2),
});
export const dateQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
});
export const searchQuery = fromToQuery.merge(dateQuery);
export const autocompleteQuery = z.object({
  q: z.string().min(1),
  limit: z.string().optional(),
});
