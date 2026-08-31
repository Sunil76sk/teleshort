/**
 * TeleShort v2.1 — Cryptographic & Token Utility
 * Handles signed ad challenge tokens, collision-resistant slug generation, and privacy hashing.
 */

const crypto = require('crypto');

const BASE62_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Generate collision-resistant URL short slug (Base62)
 * @param {number} length - Default 7 characters (3.5 trillion permutations)
 */
function generateShortSlug(length = 7) {
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += BASE62_ALPHABET[bytes[i] % BASE62_ALPHABET.length];
  }
  return result;
}

/**
 * Hash IP address for privacy-compliant deduplication
 */
function hashIp(ip) {
  const salt = process.env.CHALLENGE_SECRET || 'teleshort-ip-salt';
  return crypto.createHmac('sha256', salt).update(String(ip || '0.0.0.0')).digest('hex');
}

/**
 * Hash User Agent for device fingerprinting
 */
function hashUserAgent(ua) {
  return crypto.createHash('sha256').update(String(ua || 'unknown')).digest('hex');
}

/**
 * Extract client IP from Vercel / Cloudflare / standard proxy headers
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Sign an ad session challenge token with HMAC-SHA256
 */
function createAdChallengeToken(payload) {
  const secret = process.env.CHALLENGE_SECRET || process.env.BOT_TOKEN || 'default-challenge-secret';
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

/**
 * Verify and decode an ad session challenge token
 */
function verifyAdChallengeToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [encodedPayload, signature] = parts;
  const secret = process.env.CHALLENGE_SECRET || process.env.BOT_TOKEN || 'default-challenge-secret';
  const expectedSignature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');

  if (signature !== expectedSignature) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    // Verify expiration
    if (payload.expires_at && Date.now() > payload.expires_at) {
      return null; // Expired token
    }
    return payload;
  } catch (e) {
    return null;
  }
}

module.exports = {
  generateShortSlug,
  hashIp,
  hashUserAgent,
  getClientIp,
  createAdChallengeToken,
  verifyAdChallengeToken
};
