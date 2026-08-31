/**
 * TeleShort v2.1 — Ad Session Status Endpoint (Phase 5)
 * POST /api/ad-session/status
 * Fetches current active session status to handle page reloads, tab sync, and network reconnects.
 */

const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { verifyTelegramWebAppData } = require('../utils/auth');
const { createAdChallengeToken } = require('../utils/crypto');
const { getSupabaseClient } = require('../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return sendError(res, 'Method Not Allowed', 405);
  }

  const { session_id, initData } = req.body || {};
  if (!session_id) {
    return sendError(res, 'Session ID is required', 400, 'MISSING_SESSION_ID');
  }

  const botToken = process.env.BOT_TOKEN;
  const auth = verifyTelegramWebAppData(initData, botToken);
  if (!auth.valid || !auth.user) {
    return sendError(res, auth.error || 'Invalid Telegram authentication signature', 401, 'INVALID_AUTH');
  }

  const visitorId = auth.user.id;

  try {
    const supabase = getSupabaseClient();

    const { data: session, error } = await supabase
      .from('ad_sessions')
      .select('id, link_id, visitor_telegram_id, step, status, started_at, completed_at, expires_at, metadata, links(short_code)')
      .eq('id', session_id)
      .single();

    if (error || !session) {
      return sendError(res, 'Session not found', 404, 'SESSION_NOT_FOUND');
    }

    if (String(session.visitor_telegram_id) !== String(visitorId)) {
      return sendError(res, 'Unauthorized session access', 403, 'UNAUTHORIZED');
    }

    const now = Date.now();
    const isExpired = new Date(session.expires_at).getTime() < now;
    const shortCode = session.links?.short_code || '';

    // Issue refreshed challenge token if session is still active
    let challengeToken = null;
    if (!isExpired && (session.status === 'AD_1_STARTED' || session.status === 'AD_2_STARTED')) {
      challengeToken = createAdChallengeToken({
        session_id: session.id,
        short_code: shortCode,
        step: session.step,
        visitor_id: visitorId,
        ip_hash: session.metadata?.ip_hash || 'ip_hash',
        is_owner: session.metadata?.is_owner || false,
        is_eligible: session.metadata?.is_eligible ?? true,
        min_duration_ms: 4500,
        created_at: now,
        expires_at: new Date(session.expires_at).getTime()
      });
    }

    return sendSuccess(res, {
      session_id: session.id,
      step: session.step,
      total_steps: 2,
      status: isExpired ? 'EXPIRED' : session.status,
      is_owner: session.metadata?.is_owner || false,
      is_eligible: session.metadata?.is_eligible ?? true,
      challenge_token: challengeToken,
      is_expired: isExpired
    });
  } catch (error) {
    console.error('[Ad Session Status Error]:', error);
    return sendError(res, error.message || 'Error fetching session status', 500);
  }
};
