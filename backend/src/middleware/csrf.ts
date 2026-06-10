import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

const CSRF_HEADER = 'x-csrf-token';

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  if (req.originalUrl === '/api/v1/payments/webhook' || req.originalUrl === '/payments/webhook') {
    next();
    return;
  }

  const cookieToken = req.cookies?.csrfToken;
  const headerToken = req.headers[CSRF_HEADER] as string;

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({ status: 'error', message: 'CSRF token validation failed' });
    return;
  }

  next();
}

export function setCsrfToken(req: Request, res: Response, next: NextFunction): void {
  if (!req.cookies?.csrfToken) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie('csrfToken', token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000,
    });
  }
  next();
}
