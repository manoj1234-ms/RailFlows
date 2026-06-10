import { getRedis } from '../config/redis';

const client = getRedis();

export async function get<T>(key: string): Promise<T | undefined> {
  const raw = await client.get(key);
  if (!raw) return undefined;
  return JSON.parse(raw) as T;
}

export async function set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  const serialized = JSON.stringify(value);
  if (ttlSeconds) {
    await client.set(key, serialized, 'EX', ttlSeconds);
  } else {
    await client.set(key, serialized);
  }
}

export async function del(key: string): Promise<void> {
  await client.del(key);
}

export async function keys(pattern: string): Promise<string[]> {
  return client.keys(pattern);
}

export const RedisStore = { get, set, del, keys };
