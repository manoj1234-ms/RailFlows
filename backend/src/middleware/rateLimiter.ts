import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { Request, Response } from 'express';
import { AuthenticatedRequest } from './auth';
import { getRedis, isRedisReady } from '../config/redis';

const createRedisStore = (prefix: string) => {
  try {
    if (isRedisReady()) {
      return new RedisStore({
        sendCommand: async (...args: any[]) => {
          return getRedis().call(args[0], ...args.slice(1)) as any;
        },
        prefix: `rl:${prefix}:`,
      });
    }
  } catch {
    // Redis not available — fall back to memory store
  }
  return undefined;
};

const isLoadTest = process.env.LOAD_TEST === 'true';
const getMax = (limit: number) => (isLoadTest ? 10000 : limit);

const retryAfterHandler = (windowMs: number) => {
  return (req: Request, res: Response) => {
    const retryAfterSec = Math.ceil(windowMs / 1000);
    res.set('Retry-After', String(retryAfterSec));
  };
};

// Login limiter: 20 attempts per 15 minutes
export const loginRateLimiter = rateLimit({
  store: createRedisStore('login'),
  windowMs: 15 * 60 * 1000,
  max: getMax(20),
  message: {
    status: 'error',
    message: 'Too many login attempts. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// OTP limiter: 10 attempts per 10 minutes
export const otpRateLimiter = rateLimit({
  store: createRedisStore('otp'),
  windowMs: 10 * 60 * 1000,
  max: getMax(10),
  message: {
    status: 'error',
    message: 'Too many OTP requests. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Booking limiter: 10 requests per minute per user/IP
export const bookingRateLimiter = rateLimit({
  store: createRedisStore('booking'),
  windowMs: 1 * 60 * 1000,
  max: getMax(10),
  keyGenerator: (req: Request) => {
    const authReq = req as AuthenticatedRequest;
    return authReq.user ? `user-${authReq.user.id}` : req.ip || '';
  },
  validate: { xForwardedForHeader: false },
  message: {
    status: 'error',
    message: 'Rate limit exceeded: Booking operations are limited to 10 requests per minute.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// General limiter: 100 requests per minute
export const generalRateLimiter = rateLimit({
  store: createRedisStore('general'),
  windowMs: 1 * 60 * 1000,
  max: getMax(100),
  message: {
    status: 'error',
    message: 'Too many requests. Please slow down.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Auth limiter: 20 requests per minute for registration
export const authRateLimiter = rateLimit({
  store: createRedisStore('auth'),
  windowMs: 1 * 60 * 1000,
  max: getMax(20),
  message: {
    status: 'error',
    message: 'Too many auth requests. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Payment limiter: 30 requests per minute
export const paymentRateLimiter = rateLimit({
  store: createRedisStore('payment'),
  windowMs: 1 * 60 * 1000,
  max: getMax(30),
  message: {
    status: 'error',
    message: 'Too many payment requests. Please slow down.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Search limiter: 30 requests/min unauthenticated, 60 requests/min authenticated
export const searchRateLimiter = rateLimit({
  store: createRedisStore('search'),
  windowMs: 1 * 60 * 1000,
  max: (req: Request) => {
    const authReq = req as AuthenticatedRequest;
    return getMax(authReq.user ? 60 : 30);
  },
  message: {
    status: 'error',
    message: 'Too many search requests. Please throttle your queries.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
