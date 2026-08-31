/** TeleShort v2.2 — Admin Login / Logout */
const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { verifyPassword, signAdminToken, buildAdminSessionCookie, buildAdminLogoutCookie } = require('../utils/auth');
const { getSupabaseClient } = require('../utils/db');
const { checkRateLimit } = require('../utils/ratelimit');
const { getClientIp, hashIp } = require('../utils/crypto');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') return sendError(res, 'Method Not Allowed', 405);

  const action = String(req.body?.action || req.query?.action || 'login').toLowerCase();
  if (action === 'logout') {
    res.setHeader('Set-Cookie', buildAdminLogoutCookie());
    return sendSuccess(res, { logged_out: true });
  }

  const clientIp = getClientIp(req);
  const ipHash = hashIp(clientIp);
  const rateLimit = await checkRateLimit(ipHash, 'admin_login', 5, 900);
  if (!rateLimit.allowed) return sendError(res, 'Too many login attempts. Please try again after 15 minutes.', 429, 'ADMIN_RATE_LIMITED');

  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) return sendError(res, 'Username and password are required', 400, 'MISSING_CREDENTIALS');

  try {
    const supabase = getSupabaseClient();
    const { data: adminUser, error } = await supabase
      .from('admin_users')
      .select('id, username, password_hash, role, status')
      .eq('username', username)
      .maybeSingle();

    if (error) throw error;
    if (!adminUser || adminUser.status !== 'ACTIVE') return sendError(res, 'Invalid admin username or password', 401, 'INVALID_CREDENTIALS');
    if (!(await verifyPassword(password, adminUser.password_hash))) return sendError(res, 'Invalid admin username or password', 401, 'INVALID_CREDENTIALS');

    const token = signAdminToken({ id: adminUser.id, username: adminUser.username, role: adminUser.role });
    res.setHeader('Set-Cookie', buildAdminSessionCookie(token));

    await supabase.from('audit_logs').insert([{
      actor_type: 'ADMIN',
      actor_id: String(adminUser.id),
      action: 'ADMIN_LOGIN_SUCCESS',
      target_type: 'AUTH',
      target_id: String(adminUser.id),
      metadata: { ip_hash: ipHash, username: adminUser.username, role: adminUser.role }
    }]);

    return sendSuccess(res, {
      user: { id: adminUser.id, username: adminUser.username, role: adminUser.role },
      session: { expires_in_seconds: 12 * 60 * 60 }
    });
  } catch (error) {
    console.error('[Admin Auth Error]:', error);
    return sendError(res, error.message || 'Admin authentication error', 500, 'ADMIN_AUTH_ERROR');
  }
};
