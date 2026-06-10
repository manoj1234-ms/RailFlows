import { Request, Response, NextFunction } from 'express';
import { getDb } from '../config/db';

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000;

export async function checkAccountLockout(req: Request, res: Response, next: NextFunction): Promise<void> {
  const email = req.body?.email;
  if (!email) { next(); return; }

  const db = await getDb();
  const user = await db.get<any>('SELECT id, failed_attempts, locked_until FROM users WHERE email = ?', [email]);

  if (user) {
    if (user.locked_until) {
      const lockTime = new Date(user.locked_until).getTime();
      if (Date.now() < lockTime) {
        const remainingMin = Math.ceil((lockTime - Date.now()) / 60000);
        res.status(429).json({
          status: 'error',
          message: `Account is locked. Try again in ${remainingMin} minutes.`,
        });
        return;
      }
      await db.run('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [user.id]);
    }
  }

  next();
}

export async function recordFailedAttempt(email: string): Promise<void> {
  const db = await getDb();
  const user = await db.get<any>('SELECT id, failed_attempts FROM users WHERE email = ?', [email]);
  if (!user) return;

  const attempts = (user.failed_attempts || 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
    await db.run(
      'UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?',
      [attempts, lockedUntil, user.id]
    );
  } else {
    await db.run('UPDATE users SET failed_attempts = ? WHERE id = ?', [attempts, user.id]);
  }
}

export async function clearFailedAttempts(email: string): Promise<void> {
  const db = await getDb();
  await db.run('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE email = ?', [email]);
}
