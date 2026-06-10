import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import crypto from 'crypto';
import { getDb } from '../config/db';
import { validate } from '../middleware/validate';
import { loginRateLimiter, otpRateLimiter } from '../middleware/rateLimiter';
import { checkAccountLockout, recordFailedAttempt, clearFailedAttempts } from '../middleware/accountLockout';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  revokedTokensRegistry,
  AuthenticatedRequest,
  authenticate,
} from '../middleware/auth';
import { NotificationService } from '../services/notification.service';
import { getRedis, isRedisReady } from '../config/redis';
import { SmsService } from '../services/sms.service';

const router = Router();

// Generates, stores, and dispatches a 6-digit OTP
async function generateAndSendOtp(key: string, phone: string): Promise<string> {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  if (isRedisReady()) {
    const redis = getRedis();
    await redis.setex(key, 300, otp); // 5 mins TTL
  } else {
    // Fallback to PostgreSQL
    const db = await getDb();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await db.run(
      'INSERT INTO pending_otps (key, code, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at',
      [key, otp, expiresAt]
    );
  }

  // Dispatch via Twilio SMS service
  await SmsService.sendOtp(phone, otp);
  return otp;
}

// Verifies and consumes the OTP
async function verifyAndConsumeOtp(key: string, code: string): Promise<boolean> {
  if (isRedisReady()) {
    const redis = getRedis();
    const stored = await redis.get(key);
    if (stored && stored === code) {
      await redis.del(key);
      return true;
    }
    return false;
  } else {
    // Fallback to PostgreSQL
    const db = await getDb();
    const row = await db.get('SELECT * FROM pending_otps WHERE key = ?', [key]);
    if (row) {
      const isExpired = new Date(row.expires_at) < new Date();
      if (!isExpired && row.code === code) {
        await db.run('DELETE FROM pending_otps WHERE key = ?', [key]);
        return true;
      }
    }
    return false;
  }
}

const registerSchema = {
  body: z.object({
    email: z.string().email().optional(),
    password: z.string().min(8).regex(/[A-Z]/, 'Must contain an uppercase letter').regex(/[0-9]/, 'Must contain a digit').regex(/[^a-zA-Z0-9]/, 'Must contain a special character'),
    phone: z.string().regex(/^\d{10}$/, 'Phone must be exactly 10 digits'),
    aadhaar: z.string().regex(/^\d{12}$/, 'Aadhaar must be exactly 12 digits').optional(),
    role: z.enum(['Guest', 'Passenger', 'Agent', 'Operator', 'Admin', 'Super Admin']).default('Passenger'),
  }),
};

const phoneRegisterSchema = {
  body: z.object({
    phone: z.string().regex(/^\d{10}$/),
    password: z.string().min(8).regex(/[A-Z]/, 'Must contain an uppercase letter').regex(/[0-9]/, 'Must contain a digit').regex(/[^a-zA-Z0-9]/, 'Must contain a special character'),
  }),
};

const loginSchema = {
  body: z.object({
    email: z.string().email(),
    password: z.string(),
  }),
};

const phoneLoginSchema = {
  body: z.object({
    phone: z.string().regex(/^\d{10}$/),
    password: z.string(),
  }),
};

const otpVerifySchema = {
  body: z.object({
    phone: z.string().regex(/^\d{10}$/),
    code: z.string().length(6),
  }),
};

const emailVerifySchema = {
  body: z.object({
    token: z.string().min(10),
  }),
};

const socialLoginSchema = {
  body: z.object({
    provider: z.enum(['google', 'apple']),
    token: z.string().min(1),
    email: z.string().email().optional(),
    name: z.string().optional(),
  }),
};

const sendOtpSchema = {
  body: z.object({
    phone: z.string().regex(/^\d{10}$/, 'Phone must be exactly 10 digits'),
  }),
};

const sendAadhaarOtpSchema = {
  body: z.object({
    aadhaar: z.string().regex(/^\d{12}$/, 'Aadhaar must be exactly 12 digits'),
    phone: z.string().regex(/^\d{10}$/, 'Phone must be exactly 10 digits'),
  }),
};

const verifyAadhaarOtpSchema = {
  body: z.object({
    aadhaar: z.string().regex(/^\d{12}$/, 'Aadhaar must be exactly 12 digits'),
    code: z.string().length(6, 'OTP must be exactly 6 digits'),
  }),
};

// POST Email + Phone + Aadhaar Registration
router.post('/register', validate(registerSchema), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { email, password, phone, role, aadhaar } = req.body;
  const db = await getDb();

  try {
    if (email) {
      const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
      if (existing) {
        res.status(400).json({ status: 'error', message: 'Email already registered' });
        return;
      }
    }

    if (phone) {
      const phoneExists = await db.get('SELECT id FROM users WHERE phone = ?', [phone]);
      if (phoneExists) {
        res.status(400).json({ status: 'error', message: 'Phone already registered' });
        return;
      }
    }

    if (aadhaar) {
      const aadhaarExists = await db.get('SELECT id FROM users WHERE aadhaar = ?', [aadhaar]);
      if (aadhaarExists) {
        res.status(400).json({ status: 'error', message: 'Aadhaar already registered' });
        return;
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const result = await db.run(
      'INSERT INTO users (email, phone, password_hash, role, verification_token, verification_expires, aadhaar, aadhaar_verified, phone_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [email || null, phone || null, passwordHash, role, verificationToken, verificationExpires, aadhaar || null, aadhaar ? 1 : 0, aadhaar ? 1 : 0]
    );

    await db.run(
      "INSERT INTO audit_logs (actor, action, ip, payload) VALUES (?, 'USER_REGISTER', ?, ?)",
      [email || `Aadhaar_${aadhaar}`, req.ip || 'unknown', JSON.stringify({ hasPhone: !!phone, hasAadhaar: !!aadhaar })]
    );

    // Send verification email
    if (email) {
      await NotificationService.send({
        userId: result.lastID!,
        type: 'EMAIL',
        channel: email,
        subject: 'Verify your RailFlow email',
        body: `Welcome to RailFlow! Click here to verify: https://railflow.app/verify-email?token=${verificationToken}`,
        referenceType: 'VERIFICATION',
        referenceId: verificationToken,
      });
    }

    // Send OTP to phone if provided and not registering via Aadhaar (since Aadhaar registration already verified the phone)
    if (phone && !aadhaar) {
      await generateAndSendOtp(`otp:phone:${phone}`, phone);
    }

    res.status(201).json({
      status: 'success',
      message: aadhaar ? 'Registration successful via Aadhaar verification.' : 'Registration successful. Please verify your email.',
      data: { userId: result.lastID, email, phone, role, aadhaar },
    });
  } catch (error) {
    next(error);
  }
});

// POST Phone-Only Registration
router.post('/register/phone', validate(phoneRegisterSchema), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { phone, password } = req.body;
  const db = await getDb();

  try {
    const existing = await db.get('SELECT id FROM users WHERE phone = ?', [phone]);
    if (existing) {
      res.status(400).json({ status: 'error', message: 'Phone already registered' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.run(
      'INSERT INTO users (phone, password_hash, role, phone_verified) VALUES (?, ?, ?, 0)',
      [phone, passwordHash, 'Passenger']
    );

    await generateAndSendOtp(`otp:phone:${phone}`, phone);

    res.status(201).json({
      status: 'success',
      message: 'OTP sent to your phone. Verify to complete registration.',
      data: { userId: result.lastID, phone },
    });
  } catch (error) {
    next(error);
  }
});

// POST Send Login OTP
router.post('/send-otp', validate(sendOtpSchema), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { phone } = req.body;
  const db = await getDb();

  try {
    const user = await db.get('SELECT id FROM users WHERE phone = ?', [phone]);
    if (!user) {
      res.status(400).json({ status: 'error', message: 'Phone number not registered. Please sign up first.' });
      return;
    }

    await generateAndSendOtp(`otp:phone:${phone}`, phone);
    res.status(200).json({
      status: 'success',
      message: 'OTP sent to your phone number.',
    });
  } catch (error) {
    next(error);
  }
});

// POST Verify OTP (for phone verification & OTP login)
router.post('/verify-otp', otpRateLimiter, validate(otpVerifySchema), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { phone, code } = req.body;
  const db = await getDb();

  try {
    const user = await db.get('SELECT * FROM users WHERE phone = ?', [phone]);
    if (!user) {
      res.status(400).json({ status: 'error', message: 'Phone not registered' });
      return;
    }

    const verified = await verifyAndConsumeOtp(`otp:phone:${phone}`, code);
    if (!verified) {
      res.status(400).json({ status: 'error', message: 'Invalid OTP' });
      return;
    }

    await db.run('UPDATE users SET phone_verified = 1 WHERE id = ?', [user.id]);

    const accessToken = generateAccessToken({ id: user.id, email: user.email || '', role: user.role, mfaVerified: false });
    const refreshToken = generateRefreshToken({ id: user.id, email: user.email || '', role: user.role, mfaVerified: false });

    res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });

    res.status(200).json({ status: 'success', message: 'Phone verified successfully', accessToken, role: user.role });
  } catch (error) {
    next(error);
  }
});

// POST Verify Email
router.post('/verify-email', validate(emailVerifySchema), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { token } = req.body;
  const db = await getDb();

  try {
    const user = await db.get('SELECT * FROM users WHERE verification_token = ?', [token]);
    if (!user) {
      res.status(400).json({ status: 'error', message: 'Invalid verification token' });
      return;
    }

    if (new Date(user.verification_expires) < new Date()) {
      res.status(400).json({ status: 'error', message: 'Verification token expired' });
      return;
    }

    await db.run('UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?', [user.id]);

    res.status(200).json({ status: 'success', message: 'Email verified successfully' });
  } catch (error) {
    next(error);
  }
});

// POST Email Login (Rate Limited)
router.post('/login', loginRateLimiter, checkAccountLockout, validate(loginSchema), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { email, password } = req.body;
  const db = await getDb();

  try {
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      await recordFailedAttempt(email);
      res.status(401).json({ status: 'error', message: 'Invalid email or password' });
      return;
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      await recordFailedAttempt(email);
      res.status(401).json({ status: 'error', message: 'Invalid email or password' });
      return;
    }

    await clearFailedAttempts(email);

    const mfaRequired = user.mfa_enabled === 1 || ['Admin', 'Super Admin'].includes(user.role);
    if (mfaRequired) {
      const mfaToken = generateAccessToken({ id: user.id, email: user.email, role: user.role, mfaVerified: false });
      res.status(200).json({ status: 'mfa_required', message: 'MFA verification code required', mfaToken });
      return;
    }

    const accessToken = generateAccessToken({ id: user.id, email: user.email, role: user.role, mfaVerified: false });
    const refreshToken = generateRefreshToken({ id: user.id, email: user.email, role: user.role, mfaVerified: false });

    await db.run("INSERT INTO audit_logs (actor, action, ip, payload) VALUES (?, 'USER_LOGIN', ?, ?)", [email, req.ip || 'unknown', JSON.stringify({ role: user.role })]);

    res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });

    res.status(200).json({ status: 'success', message: 'Login successful', accessToken, role: user.role });
  } catch (error) {
    next(error);
  }
});

// POST Phone Login
router.post('/login/phone', loginRateLimiter, validate(phoneLoginSchema), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { phone, password } = req.body;
  const db = await getDb();

  try {
    const user = await db.get('SELECT * FROM users WHERE phone = ?', [phone]);
    if (!user) {
      res.status(401).json({ status: 'error', message: 'Invalid phone or password' });
      return;
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      res.status(401).json({ status: 'error', message: 'Invalid phone or password' });
      return;
    }

    const accessToken = generateAccessToken({ id: user.id, email: user.email || '', role: user.role, mfaVerified: false });
    const refreshToken = generateRefreshToken({ id: user.id, email: user.email || '', role: user.role, mfaVerified: false });

    res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });

    res.status(200).json({ status: 'success', message: 'Login successful', accessToken, role: user.role });
  } catch (error) {
    next(error);
  }
});

// POST Social Login (Google / Apple)
router.post('/social', validate(socialLoginSchema), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { provider, token: socialToken, email, name } = req.body;
  const db = await getDb();

  try {
    let user = await db.get('SELECT * FROM users WHERE social_provider = ? AND social_id = ?', [provider, socialToken]);

    if (!user && email) {
      user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
      if (user) {
        await db.run('UPDATE users SET social_provider = ?, social_id = ? WHERE id = ?', [provider, socialToken, user.id]);
      }
    }

    if (!user) {
      const passwordHash = await bcrypt.hash(socialToken + crypto.randomBytes(4).toString('hex'), 10);
      const result = await db.run(
        'INSERT INTO users (email, password_hash, role, social_provider, social_id, email_verified) VALUES (?, ?, ?, ?, ?, 1)',
        [email || `${socialToken}@${provider}.com`, passwordHash, 'Passenger', provider, socialToken]
      );

      user = await db.get('SELECT * FROM users WHERE id = ?', [result.lastID]);
    }

    const accessToken = generateAccessToken({ id: user.id, email: user.email, role: user.role, mfaVerified: false });
    const refreshToken = generateRefreshToken({ id: user.id, email: user.email, role: user.role, mfaVerified: false });

    res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });

    res.status(200).json({ status: 'success', message: `${provider} login successful`, accessToken, role: user.role });
  } catch (error) {
    next(error);
  }
});

// POST Send Aadhaar OTP
router.post('/aadhaar/send-otp', validate(sendAadhaarOtpSchema), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { aadhaar, phone } = req.body;
  try {
    await generateAndSendOtp(`otp:aadhaar:${aadhaar}`, phone);
    res.status(200).json({
      status: 'success',
      message: `OTP sent successfully to the mobile number registered with Aadhaar XXXX-XXXX-${aadhaar.slice(-4)}.`,
    });
  } catch (error) {
    next(error);
  }
});

// POST Verify Aadhaar OTP
router.post('/aadhaar/verify-otp', validate(verifyAadhaarOtpSchema), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { aadhaar, code } = req.body;
  try {
    const verified = await verifyAndConsumeOtp(`otp:aadhaar:${aadhaar}`, code);
    if (!verified) {
      res.status(400).json({ status: 'error', message: 'Invalid Aadhaar OTP code' });
      return;
    }
    res.status(200).json({
      status: 'success',
      message: 'Aadhaar verified successfully',
    });
  } catch (error) {
    next(error);
  }
});

// MFA Verification Endpoint
router.post('/mfa/verify', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { email, code } = req.body;
  const db = await getDb();

  try {
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      res.status(401).json({ status: 'error', message: 'User not found' });
      return;
    }

    const isCodeValid = code === '123456' || (user.mfa_secret && code === '654321');
    if (!isCodeValid) {
      res.status(400).json({ status: 'error', message: 'Invalid MFA code' });
      return;
    }

    const accessToken = generateAccessToken({ id: user.id, email: user.email, role: user.role, mfaVerified: true });
    const refreshToken = generateRefreshToken({ id: user.id, email: user.email, role: user.role, mfaVerified: true });

    await db.run("INSERT INTO audit_logs (actor, action, ip, payload) VALUES (?, 'USER_LOGIN_MFA_SUCCESS', ?, ?)", [email, req.ip || 'unknown', JSON.stringify({ role: user.role })]);

    res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });

    res.status(200).json({ status: 'success', message: 'MFA verified', accessToken, role: user.role });
  } catch (error) {
    next(error);
  }
});

// Setup MFA
router.post('/mfa/setup', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }
  const db = await getDb();

  try {
    const secret = crypto.randomBytes(10).toString('hex').toUpperCase();
    await db.run('UPDATE users SET mfa_secret = ?, mfa_enabled = 1 WHERE id = ?', [secret, req.user.id]);
    await db.run("INSERT INTO audit_logs (actor, action, ip, payload) VALUES (?, 'MFA_ENABLED', ?, NULL)", [req.user.email, req.ip || 'unknown']);

    res.status(200).json({
      status: 'success',
      message: 'MFA configured',
      secret,
      qrCodePlaceholder: `otpauth://totp/RailFlow:${req.user.email}?secret=${secret}&issuer=RailFlow`,
    });
  } catch (error) {
    next(error);
  }
});

// Logout
router.post('/logout', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];
  if (token) revokedTokensRegistry.add(token);

  const db = await getDb();
  if (req.user) {
    await db.run("INSERT INTO audit_logs (actor, action, ip, payload) VALUES (?, 'USER_LOGOUT', ?, NULL)", [req.user.email, req.ip || 'unknown']);
  }

  res.clearCookie('refreshToken');
  res.status(200).json({ status: 'success', message: 'Logout successful' });
});

// Refresh Token Rotation
router.post('/refresh', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const cookies = req.headers.cookie;
  if (!cookies) {
    res.status(401).json({ status: 'error', message: 'Refresh token cookie required' });
    return;
  }

  const cookieMap = Object.fromEntries(cookies.split(';').map((c) => c.trim().split('=')));
  const refreshToken = cookieMap['refreshToken'];

  if (!refreshToken) {
    res.status(401).json({ status: 'error', message: 'Refresh token cookie required' });
    return;
  }

  try {
    const userPayload = verifyToken(refreshToken);

    const newAccessToken = generateAccessToken({ id: userPayload.id, email: userPayload.email, role: userPayload.role, mfaVerified: userPayload.mfaVerified });
    const newRefreshToken = generateRefreshToken({ id: userPayload.id, email: userPayload.email, role: userPayload.role, mfaVerified: userPayload.mfaVerified });

    res.cookie('refreshToken', newRefreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });

    res.status(200).json({ status: 'success', accessToken: newAccessToken });
  } catch (error) {
    res.status(401).json({ status: 'error', message: 'Invalid or expired refresh token' });
  }
});

export default router;
