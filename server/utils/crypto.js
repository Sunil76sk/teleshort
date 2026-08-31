/** TeleShort v2.2 — Cryptographic & Token Utility */
const crypto = require('crypto');
const BASE62_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function requireChallengeSecret() {
  const secret = String(process.env.CHALLENGE_SECRET || '').trim();
  if (secret.length < 32) throw new Error('CHALLENGE_SECRET must be configured with at least 32 characters');
  return secret;
}

function generateShortSlug(length = 7) {
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) result += BASE62_ALPHABET[bytes[i] % BASE62_ALPHABET.length];
  return result;
}

function hashIp(ip) {
  return crypto.createHmac('sha256', requireChallengeSecret()).update(String(ip || '0.0.0.0')).digest('hex');
}

function hashUserAgent(ua) {
  return crypto.createHash('sha256').update(String(ua || 'unknown')).digest('hex');
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || '127.0.0.1';
}

function createAdChallengeToken(payload) {
  const secret = requireChallengeSecret();
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function verifyAdChallengeToken(token) {
  if (!token || typeof token !== 'string') return null;
  let secret;
  try { secret = requireChallengeSecret(); } catch (_) { return null; }
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  const expectedSignature = crypto.createHmac('sha256', secret).update(encodedPayload).digest();
  const actualSignature = Buffer.from(String(signature).replace(/-/g, '+').replace(/_/g, '/').padEnd(String(signature).length + ((4 - String(signature).length % 4) % 4), '='), 'base64');
  if (expectedSignature.length !== actualSignature.length || !crypto.timingSafeEqual(expectedSignature, actualSignature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (payload.expires_at && Date.now() > Number(payload.expires_at)) return null;
    return payload;
  } catch (_) { return null; }
}

module.exports = { generateShortSlug, hashIp, hashUserAgent, getClientIp, createAdChallengeToken, verifyAdChallengeToken };
