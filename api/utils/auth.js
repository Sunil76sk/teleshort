/**
 * TeleShort v2.1 — Authentication & Authorization Utility
 * Implements Telegram WebApp initData HMAC-SHA256 verification and Admin JWT / RBAC.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

/**
 * Verify Telegram WebApp initData HMAC-SHA256 signature
 * @param {string} initDataString - Raw query string from window.Telegram.WebApp.initData
 * @param {string} botToken - Telegram Bot Token
 * @param {number} maxAgeSeconds - Maximum allowed age of auth_date (default 86400 = 24h)
 * @returns {{ valid: boolean, user: object | null, error?: string }}
 */
function verifyTelegramWebAppData(initDataString, botToken, maxAgeSeconds = 86400) {
  if (!initDataString || typeof initDataString !== 'string') {
    return { valid: false, user: null, error: 'Missing initData string' };
  }

  if (!botToken) {
    return { valid: false, user: null, error: 'BOT_TOKEN is not configured on server' };
  }

  try {
    const urlParams = new URLSearchParams(initDataString);
    const hash = urlParams.get('hash');
    if (!hash) {
      return { valid: false, user: null, error: 'Missing hash parameter in initData' };
    }

    urlParams.delete('hash');

    // Check auth_date expiration
    const authDate = parseInt(urlParams.get('auth_date'), 10);
    if (authDate) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (nowSeconds - authDate > maxAgeSeconds) {
        return { valid: false, user: null, error: 'initData has expired' };
      }
    }

    // Sort parameters alphabetically
    const dataCheckString = Array.from(urlParams.entries())
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n');

    // Generate secret key: HMAC_SHA256("WebAppData", botToken)
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();

    // Calculate HMAC_SHA256(secretKey, dataCheckString)
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const isValid = calculatedHash === hash;
    if (!isValid) {
      return { valid: false, user: null, error: 'Invalid HMAC signature' };
    }

    let user = null;
    const userRaw = urlParams.get('user');
    if (userRaw) {
      user = JSON.parse(userRaw);
    }

    return {
      valid: true,
      user,
      queryId: urlParams.get('query_id'),
      startParam: urlParams.get('start_param')
    };
  } catch (error) {
    return { valid: false, user: null, error: error.message };
  }
}

/**
 * Extract and authenticate Telegram user from request headers or body
 */
function authenticateTelegramUser(req) {
  const botToken = process.env.BOT_TOKEN;
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

/**
 * Hash admin password using bcrypt
 */
async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

/**
 * Verify admin password using bcrypt
 */
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Sign Admin JWT session token
 */
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

/**
 * Verify Admin JWT session token and check RBAC role
 */
function verifyAdminToken(token, allowedRoles = []) {
  if (!token) return null;
  const secret = process.env.ADMIN_SESSION_SECRET || 'fallback-admin-secret-change-in-production';

  try {
    const decoded = jwt.verify(token, secret);
    if (allowedRoles && allowedRoles.length > 0) {
      // SUPER_ADMIN has access to all routes
      if (decoded.role === 'SUPER_ADMIN') {
        return decoded;
      }
      if (!allowedRoles.includes(decoded.role)) {
        return null; // Role not authorized
      }
    }
    return decoded;
  } catch (e) {
    return null;
  }
}

/**
 * Extract and verify admin auth from request Authorization header
 */
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
