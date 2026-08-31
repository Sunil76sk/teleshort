/**
 * TeleShort v2.1 — Authentication & Authorization Utility
 * Telegram Mini App authentication plus Admin JWT / RBAC.
 *
 * Telegram currently exposes both the legacy bot-token HMAC hash and a
 * third-party Ed25519 signature in WebApp initData. The HMAC path remains the
 * primary check; the Ed25519 path is a safe fallback for deployments where
 * the Vercel BOT_TOKEN value is stale/mismatched but the Mini App was opened
 * by the configured Telegram bot.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// This is the public Telegram bot ID, not a secret. Keeping it available as
// a fallback prevents a broken Vercel BOT_TOKEN from locking out the main app.
const TELEGRAM_BOT_ID = Number(process.env.TELEGRAM_BOT_ID || '8649768903');
const TELEGRAM_PRODUCTION_PUBLIC_KEY_HEX = 'e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d';

function buildTelegramPublicKey(rawPublicKeyHex) {
  // SubjectPublicKeyInfo wrapper for Ed25519 (OID 1.3.101.112).
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  return crypto.createPublicKey({
    key: Buffer.concat([prefix, Buffer.from(rawPublicKeyHex, 'hex')]),
    format: 'der',
    type: 'spki'
  });
}

function base64UrlToBuffer(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '='), 'base64');
}

function verifyTelegramEd25519Signature(urlParams) {
  const signature = urlParams.get('signature');
  if (!signature || !Number.isSafeInteger(TELEGRAM_BOT_ID) || TELEGRAM_BOT_ID <= 0) return false;

  const signatureParams = new URLSearchParams(urlParams.toString());
  signatureParams.delete('hash');
  signatureParams.delete('signature');

  const dataCheckString = [
    `${TELEGRAM_BOT_ID}:WebAppData`,
    ...Array.from(signatureParams.entries())
      .map(([k, v]) => `${k}=${v}`)
      .sort()
  ].join('\n');

  try {
    return crypto.verify(
      null,
      Buffer.from(dataCheckString, 'utf8'),
      buildTelegramPublicKey(TELEGRAM_PRODUCTION_PUBLIC_KEY_HEX),
      base64UrlToBuffer(signature)
    );
  } catch (_) {
    return false;
  }
}

/**
 * Verify Telegram WebApp initData.
 * Primary: HMAC-SHA256 using BOT_TOKEN.
 * Fallback: Telegram's Ed25519 signature using the public bot ID.
 */
function verifyTelegramWebAppData(initDataString, botToken, maxAgeSeconds = 86400) {
  if (!initDataString || typeof initDataString !== 'string') {
    return { valid: false, user: null, error: 'Missing initData string' };
  }

  try {
    const urlParams = new URLSearchParams(initDataString);
    const hash = urlParams.get('hash');

    if (!hash && !urlParams.get('signature')) {
      return { valid: false, user: null, error: 'Missing Telegram authentication signature' };
    }

    const authDate = parseInt(urlParams.get('auth_date'), 10);
    if (authDate) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (authDate > nowSeconds + 60) {
        return { valid: false, user: null, error: 'initData auth_date is from the future' };
      }
      if (nowSeconds - authDate > maxAgeSeconds) {
        return { valid: false, user: null, error: 'initData has expired' };
      }
    }

    let hmacValid = false;
    if (hash && botToken) {
      const hmacParams = new URLSearchParams(urlParams.toString());
      hmacParams.delete('hash');
      const dataCheckString = Array.from(hmacParams.entries())
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join('\n');

      const secretKey = crypto
        .createHmac('sha256', botToken)
        .update('WebAppData')
        .digest();

      const calculatedHash = crypto
        .createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

      const expected = Buffer.from(calculatedHash, 'hex');
      const received = Buffer.from(hash, 'hex');
      hmacValid = expected.length === received.length && crypto.timingSafeEqual(expected, received);
    }

    const signatureValid = verifyTelegramEd25519Signature(urlParams);

    if (!hmacValid && !signatureValid) {
      if (!botToken) {
        return { valid: false, user: null, error: 'BOT_TOKEN is not configured and Telegram signature validation failed' };
      }
      return { valid: false, user: null, error: 'Invalid Telegram authentication signature' };
    }

    let user = null;
    const userRaw = urlParams.get('user');
    if (userRaw) user = JSON.parse(userRaw);

    return {
      valid: true,
      user,
      queryId: urlParams.get('query_id'),
      startParam: urlParams.get('start_param'),
      verification: hmacValid ? 'hmac' : 'ed25519'
    };
  } catch (error) {
    return { valid: false, user: null, error: error.message || 'Telegram authentication failed' };
  }
}

function authenticateTelegramUser(req) {
  const botToken = typeof process.env.BOT_TOKEN === 'string' ? process.env.BOT_TOKEN.trim() : '';
  const initData = req.headers['x-telegram-init-data'] || req.body?.initData || req.query?.initData;

  const result = verifyTelegramWebAppData(initData, botToken);
  if (!result.valid || !result.user) {
    return { authenticated: false, error: result.error || 'Authentication failed' };
  }

  return {
    authenticated: true,
    user: result.user,
    startParam: result.startParam
  };
}

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function signAdminToken(adminUser) {
  const secret = process.env.ADMIN_SESSION_SECRET || 'fallback-admin-secret-change-in-production';
  return jwt.sign(
    {
      id: adminUser.id,
      username: adminUser.username,
      role: adminUser.role
    },
    secret,
    { expiresIn: '7d' }
  );
}

function verifyAdminToken(token, allowedRoles = []) {
  if (!token) return null;
  const secret = process.env.ADMIN_SESSION_SECRET || 'fallback-admin-secret-change-in-production';

  try {
    const decoded = jwt.verify(token, secret);
    if (allowedRoles && allowedRoles.length > 0) {
      if (decoded.role === 'SUPER_ADMIN') return decoded;
      if (!allowedRoles.includes(decoded.role)) return null;
    }
    return decoded;
  } catch (e) {
    return null;
  }
}

function authenticateAdmin(req, allowedRoles = []) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { authenticated: false, error: 'Missing or malformed Authorization header' };
  }

  const token = authHeader.split(' ')[1];
  const admin = verifyAdminToken(token, allowedRoles);

  if (!admin) {
    return { authenticated: false, error: 'Unauthorized or insufficient permissions' };
  }

  return { authenticated: true, admin };
}

module.exports = {
  verifyTelegramWebAppData,
  authenticateTelegramUser,
  hashPassword,
  verifyPassword,
  signAdminToken,
  verifyAdminToken,
  authenticateAdmin
};
