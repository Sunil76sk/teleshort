/**
 * TeleShort v2.1 — Ad Session Preparation Endpoint (Phase 4 Foundation)
 * POST /api/visitor/session-start
 * Creates an authorized ad session and generates an HMAC-SHA256 signed challenge token.
 * NOTE: Strictly prepares the session. DOES NOT credit financial rewards.
 */

const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { verifyTelegramWebAppData } = require('../utils/auth');
const { checkChatMember } = require('../utils/telegram');
const { evaluateVisitorFraud } = require('../utils/fraud');
const { createAdChallengeToken, getClientIp, hashIp, hashUserAgent } = require('../utils/crypto');
const { checkRateLimit } = require('../utils/ratelimit');
const { getSupabaseClient } = require('../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return sendError(res, 'Method Not Allowed', 405);
  }

  const { short_code, initData } = req.body || {};
  if (!short_code) {
    return sendError(res, 'Short code is required', 400, 'MISSING_SHORT_CODE');
  }

  const botToken = process.env.BOT_TOKEN;
  const auth = verifyTelegramWebAppData(initData, botToken);
  if (!auth.valid || !auth.user) {
    return sendError(res, auth.error || 'Invalid Telegram authentication signature', 401, 'INVALID_AUTH');
  }

  const visitorId = auth.user.id;
  const clientIp = getClientIp(req);
  const ipHash = hashIp(clientIp);
  const userAgent = req.headers['user-agent'] || '';
  const uaHash = hashUserAgent(userAgent);

  // Rate limit session starts (max 10 per minute per visitor)
  const rateLimit = await checkRateLimit(`sess_${visitorId}`, 'session_start', 10, 60);
  if (!rateLimit.allowed) {
    return sendError(res, 'Too many ad requests. Please slow down.', 429, 'RATE_LIMITED');
  }

  try {
    const supabase = getSupabaseClient();

    // 1. Fetch Link
    const { data: link, error: linkErr } = await supabase
      .from('links')
      .select('id, short_code, owner_id, status, original_url')
      .eq('short_code', short_code.trim())
      .single();

    if (linkErr || !link) {
      return sendError(res, 'Link not found', 404, 'LINK_NOT_FOUND');
    }

    if (link.status !== 'ACTIVE') {
      return sendError(res, `This link is ${link.status.toLowerCase()} and cannot be unlocked`, 403, 'LINK_NOT_ACTIVE');
    }

    // 2. Enforce Force Join Gate
    const { data: settingsRecord } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'force_join_config')
      .single();

    const forceJoinConfig = settingsRecord?.value || { enabled: false };
    if (forceJoinConfig.enabled && forceJoinConfig.channel_id) {
      const memberCheck = await checkChatMember(forceJoinConfig.channel_id, visitorId, false);
      if (!memberCheck.joined) {
        return sendError(res, 'You must join the official channel before unlocking this link', 403, 'FORCE_JOIN_REQUIRED');
      }
    }

    // 3. Evaluate Fraud Heuristics & Eligibility
    const fraudEval = await evaluateVisitorFraud({
      ownerId: link.owner_id,
      visitorId,
      linkId: link.id,
      ipHash,
      userAgent,
      recentRequestsCount: rateLimit.count
    });

    const isOwner = (String(link.owner_id) === String(visitorId));
    const now = Date.now();
    const expiresAt = now + (5 * 60 * 1000); // 5 minutes expiration
    const minDurationMs = 4500; // Minimum 4.5 seconds per ad step

    // 4. Create record in ad_sessions table
    const { data: adSession, error: sessionErr } = await supabase
      .from('ad_sessions')
      .insert([
        {
          link_id: link.id,
          visitor_telegram_id: visitorId,
          step: 1,
          status: 'AD_1_STARTED',
          challenge_hash: 'PENDING_ISSUE',
          started_at: new Date(now).toISOString(),
          expires_at: new Date(expiresAt).toISOString(),
          metadata: {
            is_owner: isOwner,
            is_eligible: fraudEval.isEligible,
            ineligible_reason: fraudEval.reason,
            fraud_score: fraudEval.score,
            ip_hash: ipHash,
            ua_hash: uaHash
          }
        }
      ])
      .select('id')
      .single();

    if (sessionErr || !adSession) {
      throw sessionErr || new Error('Failed to create ad session');
    }

    // 5. Generate Signed HMAC Challenge Token
    const challengePayload = {
      session_id: adSession.id,
      short_code: link.short_code,
      step: 1,
      visitor_id: visitorId,
      ip_hash: ipHash,
      is_owner: isOwner,
      is_eligible: fraudEval.isEligible,
      min_duration_ms: minDurationMs,
      created_at: now,
      expires_at: expiresAt
    };

    const challengeToken = createAdChallengeToken(challengePayload);

    // Update challenge hash on the ad session
    await supabase
      .from('ad_sessions')
      .update({ challenge_hash: ipHash })
      .eq('id', adSession.id);

    return sendSuccess(res, {
      session_id: adSession.id,
      short_code: link.short_code,
      step: 1,
      total_steps: 2,
      timer_seconds: 5,
      challenge_token: challengeToken,
      is_owner: isOwner,
      is_eligible: fraudEval.isEligible,
      ineligible_reason: fraudEval.reason,
      status: 'AD_1_STARTED'
    });
  } catch (error) {
    console.error('[Session Start Error]:', error);
    return sendError(res, error.message || 'Error starting ad session', 500);
  }
};
