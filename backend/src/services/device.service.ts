import { getDb } from '../config/db';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger';

const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret';
const REFRESH_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

export class DeviceService {
  static generateDeviceId(req: any): string {
    const ua = req.headers['user-agent'] || 'unknown';
    const ip = req.ip || '0.0.0.0';
    return crypto.createHash('sha256').update(`${ua}:${ip}`).digest('hex').slice(0, 16);
  }

  static async registerDevice(userId: number, deviceId: string, deviceName: string): Promise<string> {
    const db = await getDb();
    const refreshToken = jwt.sign(
      { id: userId, deviceId, type: 'refresh' },
      JWT_REFRESH_SECRET,
      { expiresIn: REFRESH_EXPIRY_SECONDS }
    );

    const expiresAt = new Date(Date.now() + REFRESH_EXPIRY_SECONDS * 1000).toISOString();

    await db.run(
      `INSERT INTO user_devices (user_id, device_id, device_name, refresh_token, refresh_token_expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, device_id)
       DO UPDATE SET refresh_token = excluded.refresh_token,
                     refresh_token_expires_at = excluded.refresh_token_expires_at,
                     last_used_at = CURRENT_TIMESTAMP`,
      [userId, deviceId, deviceName, refreshToken, expiresAt]
    );

    return refreshToken;
  }

  static async rotateRefreshToken(userId: number, deviceId: string, oldToken: string): Promise<string | null> {
    const db = await getDb();

    const device = await db.get(
      'SELECT * FROM user_devices WHERE user_id = ? AND device_id = ?',
      [userId, deviceId]
    );
    if (!device || device.refresh_token !== oldToken) {
      logger.warn({ msg: '[Device] Refresh token mismatch', userId, deviceId });
      return null;
    }

    const newToken = jwt.sign(
      { id: userId, deviceId, type: 'refresh' },
      JWT_REFRESH_SECRET,
      { expiresIn: REFRESH_EXPIRY_SECONDS }
    );

    const expiresAt = new Date(Date.now() + REFRESH_EXPIRY_SECONDS * 1000).toISOString();
    await db.run(
      'UPDATE user_devices SET refresh_token = ?, refresh_token_expires_at = ?, last_used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND device_id = ?',
      [newToken, expiresAt, userId, deviceId]
    );

    return newToken;
  }

  static async revokeDevice(userId: number, deviceId: string): Promise<void> {
    const db = await getDb();
    await db.run(
      'DELETE FROM user_devices WHERE user_id = ? AND device_id = ?',
      [userId, deviceId]
    );
    logger.info({ msg: '[Device] Revoked', userId, deviceId });
  }

  static async revokeAllDevices(userId: number): Promise<void> {
    const db = await getDb();
    await db.run('DELETE FROM user_devices WHERE user_id = ?', [userId]);
    logger.info({ msg: '[Device] All devices revoked', userId });
  }

  static async getDevices(userId: number): Promise<any[]> {
    const db = await getDb();
    return db.all(
      'SELECT device_id, device_name, last_used_at, created_at FROM user_devices WHERE user_id = ? ORDER BY last_used_at DESC',
      [userId]
    );
  }
}
