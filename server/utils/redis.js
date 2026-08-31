/**
 * TeleShort v2.1 — Upstash Redis Client Utility
 * Distributed key-value and sorted-set store for stateless serverless functions.
 */

const { Redis } = require('@upstash/redis');

let redisClient = null;

function getRedisClient() {
  if (redisClient) {
    return redisClient;
  }

  const restUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL;
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (restUrl && restToken) {
    redisClient = new Redis({
      url: restUrl.trim(),
      token: restToken.trim()
    });
    return redisClient;
  }

  if (restUrl && restUrl.startsWith('https://')) {
    redisClient = Redis.fromEnv();
    return redisClient;
  }

  return null;
}

async function redisSet(key, value, ttlSeconds = 3600) {
  try {
    const client = getRedisClient();
    if (!client) return false;
    await client.set(key, JSON.stringify(value), { ex: ttlSeconds });
    return true;
  } catch (error) {
    console.warn(`[Redis Set Error] ${key}:`, error.message);
    return false;
  }
}

async function redisGet(key) {
  try {
    const client = getRedisClient();
    if (!client) return null;
    const data = await client.get(key);
    if (!data) return null;
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (error) {
    console.warn(`[Redis Get Error] ${key}:`, error.message);
    return null;
  }
}

async function redisDel(key) {
  try {
    const client = getRedisClient();
    if (!client) return false;
    await client.del(key);
    return true;
  } catch (error) {
    console.warn(`[Redis Del Error] ${key}:`, error.message);
    return false;
  }
}

module.exports = {
  getRedisClient,
  redisSet,
  redisGet,
  redisDel
};
