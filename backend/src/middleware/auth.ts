import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// Generate dynamic RSA-2048 keypair on startup for RS256 token signing
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem',
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
  },
});

// Mock Redis token revocation registry
export const revokedTokensRegistry = new Set<string>();

export interface UserPayload {
  id: number;
  email: string;
  role: 'Guest' | 'Passenger' | 'Agent' | 'Operator' | 'Admin' | 'Super Admin';
  mfaVerified: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: UserPayload;
}

export function generateAccessToken(user: { id: number; email: string; role: string; mfaVerified: boolean }): string {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, mfaVerified: user.mfaVerified },
    privateKey,
    { algorithm: 'RS256', expiresIn: '15m' }
  );
}

export function generateRefreshToken(user: { id: number; email: string; role: string; mfaVerified: boolean }): string {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, mfaVerified: user.mfaVerified },
    privateKey,
    { algorithm: 'RS256', expiresIn: '7d' }
  );
}

export function verifyToken(token: string): UserPayload {
  const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as any;
  return {
    id: decoded.id,
    email: decoded.email,
    role: decoded.role,
    mfaVerified: !!decoded.mfaVerified,
  };
}

// Authentication Middleware
export const authenticate = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ status: 'error', message: 'Access token required' });
    return;
  }

  const token = authHeader.split(' ')[1];

  if (revokedTokensRegistry.has(token)) {
    res.status(401).json({ status: 'error', message: 'Token has been revoked' });
    return;
  }

  try {
    const user = verifyToken(token);
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ status: 'error', message: 'Invalid or expired access token' });
  }
};

// Role-Based Access Control Middleware
export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ status: 'error', message: 'Unauthorized' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        status: 'error',
        message: `Forbidden: role ${req.user.role} does not have access to this resource`,
      });
      return;
    }

    next();
  };
};

// Admin & Super Admin MFA Re-authentication check
export const requireMfaForAdmins = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }

  if (['Admin', 'Super Admin'].includes(req.user.role) && !req.user.mfaVerified) {
    res.status(403).json({
      status: 'error',
      message: 'MFA re-authentication required for administrative access',
    });
    return;
  }

  next();
};
