/**
 * TeleShort v2.2 — Authentication & Authorization Utility
 * Telegram Mini App authentication plus secure admin session cookies / RBAC.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const TELEGRAM_BOT_ID = Number(process.env.TELEGRAM_BOT_ID || '8649768903');
const TELEGRAM_PRODUCTION_PUBLIC_KEY_HEX = 'e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d';
const ADMIN_COOKIE_NAME = 'teleshort_admin_session';
const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60;

function requireAdminSessionSecret() {
  const secret = String(process.env.ADMIN_SESSION_SECRET || '').trim();
  if (secret.length < 32) throw new Error('ADMIN_SESSION_SECRET must be configured with at least 32 characters');
  return secret;
}

function buildTelegramPublicKey(rawPublicKeyHex) {
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  return crypto.createPublicKey({ key: Buffer.concat([prefix, Buffer.from(rawPublicKeyHex, 'hex')]), format: 'der', type: 'spki' });
}

function base64UrlToBuffer(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '='), 'base64');
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function verifyTelegramEd25519Signature(urlParams) {
  const signature = urlParams.get('signature');
  if (!signature || !Number.isSafeInteger(TELEGRAM_BOT_ID) || TELEGRAM_BOT_ID <= 0) return false;
  const signatureParams = new URLSearchParams(urlParams.toString());
  signatureParams.delete('hash');
  signatureParams.delete('signature');
  const dataCheckString = [`${TELEGRAM_BOT_ID}:WebAppData`, ...Array.from(signatureParams.entries()).map(([k, v]) => `${k}=${v}`).sort()].join('\n');
  try {
    return crypto.verify(null, Buffer.from(dataCheckString, 'utf8'), buildTelegramPublicKey(TELEGRAM_PRODUCTION_PUBLIC_KEY_HEX), base64UrlToBuffer(signature));
  } catch (_) { return false; }
}

function verifyTelegramWebAppData(initDataString, botToken, maxAgeSeconds = 86400) {
  if (!initDataString || typeof initDataString !== 'string') return { valid: false, user: null, error: 'Missing initData string' };
  try {
    const urlParams = new URLSearchParams(initDataString);
    const hash = urlParams.get('hash');
    if (!hash && !urlParams.get('signature')) return { valid: false, user: null, error: 'Missing Telegram authentication signature' };

    const authDateRaw = urlParams.get('auth_date');
    const authDate = Number(authDateRaw);
    if (!authDateRaw || !Number.isSafeInteger(authDate) || authDate <= 0) {
      return { valid: false, user: null, error: 'Telegram auth_date is missing or invalid' };
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (authDate > nowSeconds + 60) return { valid: false, user: null, error: 'initData auth_date is from the future' };
    if (nowSeconds - authDate > maxAgeSeconds) return { valid: false, user: null, error: 'initData has expired' };

    let hmacValid = false;
    const cleanBotToken = typeof botToken === 'string' ? botToken.trim() : '';
    if (hash && cleanBotToken) {
      const hmacParams = new URLSearchParams(urlParams.toString());
      hmacParams.delete('hash');
      const dataCheckString = Array.from(hmacParams.entries()).map(([k, v]) => `${k}=${v}`).sort().join('\n');
      const secretKey = crypto.createHmac('sha256', 'WebAppData').update(cleanBotToken).digest();
      const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
      const expected = Buffer.from(calculatedHash, 'hex');
      const received = Buffer.from(hash, 'hex');
      hmacValid = expected.length === received.length && crypto.timingSafeEqual(expected, received);
    }

    const signatureValid = verifyTelegramEd25519Signature(urlParams);
    if (!hmacValid && !signatureValid) return { valid: false, user: null, error: cleanBotToken ? 'Invalid Telegram authentication signature' : 'BOT_TOKEN is not configured and Telegram signature validation failed' };

    const userRaw = urlParams.get('user');
    const user = userRaw ? JSON.parse(userRaw) : null;
    if (!user || !Number.isSafeInteger(Number(user.id)) || Number(user.id) <= 0) return { valid: false, user: null, error: 'Telegram user data is missing or invalid' };
    return { valid: true, user, queryId: urlParams.get('query_id'), startParam: urlParams.get('start_param'), verification: hmacValid ? 'hmac' : 'ed25519' };
  } catch (error) {
    return { valid: false, user: null, error: error.message || 'Telegram authentication failed' };
  }
}

function authenticateTelegramUser(req) {
  const botToken = typeof process.env.BOT_TOKEN === 'string' ? process.env.BOT_TOKEN.trim() : '';
  const initData = req.headers['x-telegram-init-data'] || req.body?.initData || req.query?.initData;
  const result = verifyTelegramWebAppData(initData, botToken);
  if (!result.valid || !result.user) return { authenticated: false, error: result.error || 'Authentication failed' };
  return { authenticated: true, user: result.user, startParam: result.startParam };
}

async function hashPassword(password) { return bcrypt.hash(password, 12); }
async function verifyPassword(password, hash) { return bcrypt.compare(password, hash); }

function signAdminToken(adminUser) {
  const secret = requireAdminSessionSecret();
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(JSON.stringify({
    id: adminUser.id,
    username: adminUser.username,
    role: adminUser.role,
    iat: now,
    exp: now + ADMIN_SESSION_TTL_SECONDS
  }));
  const input = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', secret).update(input).digest();
  return `${input}.${base64UrlEncode(signature)}`;
}

function verifyAdminToken(token, allowedRoles = []) {
  if (!token || typeof token !== 'string') return null;
  let secret;
  try { secret = requireAdminSessionSecret(); } catch (_) { return null; }
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const [header, payload, signature] = parts;
    const expected = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest();
    const actual = base64UrlToBuffer(signature);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    const decodedHeader = JSON.parse(base64UrlToBuffer(header).toString('utf8'));
    if (decodedHeader.alg !== 'HS256' || decodedHeader.typ !== 'JWT') return null;
    const decoded = JSON.parse(base64UrlToBuffer(payload).toString('utf8'));
    if (!decoded.id || !decoded.role || decoded.exp <= Math.floor(Date.now() / 1000)) return null;
    if (allowedRoles?.length > 0 && decoded.role !== 'SUPER_ADMIN' && !allowedRoles.includes(decoded.role)) return null;
    return decoded;
  } catch (_) { return null; }
}

function parseCookies(req) {
  const header = req.headers?.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function getAdminSessionToken(req) {
  const cookies = parseCookies(req);
  if (cookies[ADMIN_COOKIE_NAME]) return cookies[ADMIN_COOKIE_NAME];
  const authHeader = req.headers?.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  return null;
}

function buildAdminSessionCookie(token) {
  return `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${ADMIN_SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

function buildAdminLogoutCookie() {
  return `${ADMIN_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function authenticateAdmin(req, allowedRoles = []) {
  const token = getAdminSessionToken(req);
  if (!token) return { authenticated: false, error: 'Admin session required' };
  const admin = verifyAdminToken(token, allowedRoles);
  if (!admin) return { authenticated: false, error: 'Unauthorized or insufficient permissions' };
  return { authenticated: true, admin };
}

module.exports = {
  verifyTelegramWebAppData,
  authenticateTelegramUser,
  hashPassword,
  verifyPassword,
  signAdminToken,
  verifyAdminToken,
  authenticateAdmin,
  buildAdminSessionCookie,
  buildAdminLogoutCookie,
  getAdminSessionToken,
  ADMIN_COOKIE_NAME
};
