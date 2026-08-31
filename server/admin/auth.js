/**
 * TeleShort v2.1 — Admin Authentication Endpoint
 * POST /api/admin/auth
 * Authenticates admin users using bcrypt password verification, issues JWT session, and logs audit events.
 */

const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { verifyPassword, signAdminToken } = require('../utils/auth');
const { getSupabaseClient } = require('../utils/db');
const { checkRateLimit } = require('../utils/ratelimit');
const { getClientIp, hashIp } = require('../utils/crypto');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return sendError(res, 'Method Not Allowed', 405);
  }

  const clientIp = getClientIp(req);
  const ipHash = hashIp(clientIp);

  // Strict rate limit on admin login attempts (5 per 15 minutes)
  const rateLimit = await checkRateLimit(ipHash, 'admin_login', 5, 900);
  if (!rateLimit.allowed) {
    return sendError(res, 'Too many login attempts. Please try again after 15 minutes.', 429, 'ADMIN_RATE_LIMITED');
  }

  const { username, password } = req.body || {};

  if (!username || !password) {
    return sendError(res, 'Username and password are required', 400, 'MISSING_CREDENTIALS');
  }

  try {
    const supabase = getSupabaseClient();

    // 1. Fetch admin user
    const { data: adminUser, error } = await supabase
      .from('admin_users')
      .select('id, username, password_hash, role')
      .eq('username', String(username).trim())
      .single();

    if (error || !adminUser) {
      return sendError(res, 'Invalid admin username or password', 401, 'INVALID_CREDENTIALS');
    }

    // 2. Verify password with bcrypt
    const isPasswordValid = await verifyPassword(password, adminUser.password_hash);
    if (!isPasswordValid) {
      return sendError(res, 'Invalid admin username or password', 401, 'INVALID_CREDENTIALS');
    }

    // 3. Generate JWT Token
    const token = signAdminToken({
      id: adminUser.id,
      username: adminUser.username,
      role: adminUser.role
    });

    // 4. Log Audit Event
    await supabase.from('audit_logs').insert([
      {
        actor_type: 'ADMIN',
        actor_id: adminUser.id,
        action: 'ADMIN_LOGIN_SUCCESS',
        target_type: 'AUTH',
        target_id: adminUser.id,
        metadata: {
          ip_hash: ipHash,
          username: adminUser.username,
          role: adminUser.role
        }
      }
    ]);

    return sendSuccess(res, {
      token,
      user: {
        id: adminUser.id,
        username: adminUser.username,
        role: adminUser.role
      }
    });
  } catch (error) {
    console.error('[Admin Auth Error]:', error);
    return sendError(res, error.message || 'Admin authentication error', 500);
  }
};
