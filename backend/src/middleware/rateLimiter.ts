import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { Request } from 'express';
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

const validate = { xForwardedForHeader: false };

export const loginRateLimiter = rateLimit({
  store: createRedisStore('login'),
  windowMs: 15 * 60 * 1000,
  max: getMax(20),
  validate,
  message: { status: 'error', message: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const otpRateLimiter = rateLimit({
  store: createRedisStore('otp'),
  windowMs: 10 * 60 * 1000,
  max: getMax(10),
  validate,
  message: { status: 'error', message: 'Too many OTP requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const bookingRateLimiter = rateLimit({
  store: createRedisStore('booking'),
  windowMs: 1 * 60 * 1000,
  max: getMax(10),
  validate,
  keyGenerator: (req: Request) => {
    const authReq = req as AuthenticatedRequest;
    return authReq.user ? `user-${authReq.user.id}` : ipKeyGenerator(req.ip || 'unknown');
  },
  message: { status: 'error', message: 'Rate limit exceeded: Booking operations are limited to 10 requests per minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const generalRateLimiter = rateLimit({
  store: createRedisStore('general'),
  windowMs: 1 * 60 * 1000,
  max: getMax(100),
  validate,
  message: { status: 'error', message: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const authRateLimiter = rateLimit({
  store: createRedisStore('auth'),
  windowMs: 1 * 60 * 1000,
  max: getMax(20),
  validate,
  message: { status: 'error', message: 'Too many auth requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const paymentRateLimiter = rateLimit({
  store: createRedisStore('payment'),
  windowMs: 1 * 60 * 1000,
  max: getMax(30),
  validate,
  message: { status: 'error', message: 'Too many payment requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const searchRateLimiter = rateLimit({
  store: createRedisStore('search'),
  windowMs: 1 * 60 * 1000,
  max: (req: Request) => {
    const authReq = req as AuthenticatedRequest;
    return getMax(authReq.user ? 60 : 30);
  },
  validate,
  message: { status: 'error', message: 'Too many search requests. Please throttle your queries.' },
  standardHeaders: true,
  legacyHeaders: false,
});
