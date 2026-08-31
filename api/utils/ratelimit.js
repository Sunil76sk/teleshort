/**
 * TeleShort v2.1 — Distributed Sliding-Window Rate Limiter
 * 
 * Algorithm: Sliding-Window Log using Redis Sorted Sets (ZSET)
 * Time Complexity: O(log(N) + M) where N = requests in window, M = expired entries removed
 * 
 * Mechanism:
 * 1. Each request records a timestamped element in a Sorted Set (ZSET) keyed by `ratelimit:{action}:{identifier}`.
 * 2. Old timestamps outside the sliding window (now - windowMs) are atomically trimmed with ZREMRANGEBYSCORE.
 * 3. ZCARD counts exact requests in the sliding time window.
 * 4. If count < maxRequests, the current request timestamp is added with ZADD and TTL refreshed with EXPIRE.
 * 5. Prevents fixed-window boundary burst exploits.
 */

const { getRedisClient } = require('./redis');

// In-memory sliding window fallback for local testing or when Redis is unconfigured
const memorySlidingLogs = new Map();

async function checkRateLimit(identifier, action, maxRequests = 30, windowSeconds = 60) {
  const sanitizedId = String(identifier).replace(/[^a-zA-Z0-9_:-]/g, '');
  const key = `ratelimit:${action}:${sanitizedId}`;
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const windowStart = now - windowMs;

  const client = getRedisClient();

  if (client) {
    try {
      // 1. Remove expired timestamps older than current sliding window
      await client.zremrangebyscore(key, 0, windowStart);

      // 2. Count requests in the current sliding window
      const count = await client.zcard(key);

      if (count >= maxRequests) {
        return {
          allowed: false,
          count,
          remaining: 0,
          resetIn: windowSeconds,
          algorithm: 'SLIDING_WINDOW_LOG_REDIS'
        };
      }

      // 3. Add current timestamp to sliding log
      const member = `${now}-${Math.random().toString(36).substring(2, 8)}`;
      await client.zadd(key, { score: now, member });
      await client.expire(key, windowSeconds * 2);

      return {
        allowed: true,
        count: count + 1,
        remaining: maxRequests - (count + 1),
        resetIn: windowSeconds,
        algorithm: 'SLIDING_WINDOW_LOG_REDIS'
      };
    } catch (error) {
      console.warn(`[Redis Sliding Limit Error] Falling back to local log for ${key}:`, error.message);
    }
  }

  // In-Memory Sliding Window Fallback
  if (!memorySlidingLogs.has(key)) {
    memorySlidingLogs.set(key, []);
  }

  const timestamps = memorySlidingLogs.get(key).filter(ts => ts > windowStart);
  if (timestamps.length >= maxRequests) {
    memorySlidingLogs.set(key, timestamps);
    return {
      allowed: false,
      count: timestamps.length,
      remaining: 0,
      resetIn: windowSeconds,
      algorithm: 'SLIDING_WINDOW_LOG_MEMORY'
    };
  }

  timestamps.push(now);
  memorySlidingLogs.set(key, timestamps);

  return {
    allowed: true,
    count: timestamps.length,
    remaining: maxRequests - timestamps.length,
    resetIn: windowSeconds,
    algorithm: 'SLIDING_WINDOW_LOG_MEMORY'
  };
}

module.exports = {
  checkRateLimit
};
