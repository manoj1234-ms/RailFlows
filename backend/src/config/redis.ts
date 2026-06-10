import Redis from 'ioredis';
import dotenv from 'dotenv';
import logger from '../utils/logger';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let redisClient: Redis | null = null;
let isConnected = false;

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy(times) {
        if (times > 5) {
          logger.warn('[Redis] Max retry attempts reached. Running without Redis.');
          return null;
        }
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });

    redisClient.on('connect', () => {
      isConnected = true;
      logger.info('[Redis] Connected successfully');
    });

    redisClient.on('error', (err) => {
      isConnected = false;
      logger.error({ msg: '[Redis] Connection error', error: err.message });
    });

    redisClient.on('close', () => {
      isConnected = false;
      logger.warn('[Redis] Connection closed');
    });
  }
  return redisClient;
}

export async function initRedis(): Promise<void> {
  try {
    const client = getRedis();
    await client.connect();
    isConnected = true;
    await getRedisVersion();
    logger.info('[Redis] Initialized successfully (v' + (_redisVersion || '?') + ')');
  } catch (err: any) {
    isConnected = false;
    logger.warn({ msg: '[Redis] Failed to connect, running without Redis', error: err.message });
  }
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch { }
    redisClient = null;
    isConnected = false;
    logger.info('[Redis] Disconnected');
  }
}

export function isRedisReady(): boolean {
  return isConnected;
}

let _redisVersion: string | null = null;

export async function getRedisVersion(): Promise<string | null> {
  if (_redisVersion) return _redisVersion;
  try {
    const client = getRedis();
    const info = await client.info('server');
    const match = info.match(/redis_version:([^\r\n]+)/);
    _redisVersion = match ? match[1].trim() : null;
    return _redisVersion;
  } catch {
    return null;
  }
}

export function isBullMQCompatible(): boolean {
  if (!_redisVersion) return false;
  const parts = _redisVersion.split('.').map(Number);
  return parts[0] >= 5;
}

export { Redis };
