/**
 * TeleShort v2.1 — Monetag Ad Session Start Endpoint (Phase 5)
 * POST /api/ad-session/start
 * Initializes an authorized 2-step Monetag ad session and returns Step 1 challenge token.
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

  // Rate limit session starts (max 10 starts per minute per visitor)
  const rateLimit = await checkRateLimit(`ad_start_${visitorId}`, 'ad_session_start', 10, 60);
  if (!rateLimit.allowed) {
    return sendError(res, 'Too many ad session requests. Please wait a moment.', 429, 'RATE_LIMITED');
  }

  try {
    const supabase = getSupabaseClient();

    // 1. Fetch Link & Verify Active Status
    const { data: link, error: linkErr } = await supabase
      .from('links')
      .select('id, short_code, owner_id, status')
      .eq('short_code', short_code.trim())
      .single();

    if (linkErr || !link) {
      return sendError(res, 'Link not found', 404, 'LINK_NOT_FOUND');
    }

    if (link.status !== 'ACTIVE') {
      return sendError(res, `Link is ${link.status.toLowerCase()} and cannot be unlocked`, 403, 'LINK_NOT_ACTIVE');
    }

    // 2. Force Join Verification Gate
    const { data: settingsRecord } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'force_join_config')
      .single();

    const forceJoinConfig = settingsRecord?.value || { enabled: false };
    if (forceJoinConfig.enabled && forceJoinConfig.channel_id) {
      const memberCheck = await checkChatMember(forceJoinConfig.channel_id, visitorId, false);
      if (!memberCheck.joined) {
        return sendError(res, 'You must join the official channel before watching ads', 403, 'FORCE_JOIN_REQUIRED');
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
    const expiresAt = now + (5 * 60 * 1000); // 5 minutes validity
    const minDurationMs = 4500; // 4.5s anti-abuse watch signal

    // 4. Session Persistence & Resumption Check (Single active session per user/link)
    const { data: existingActiveSessions } = await supabase
      .from('ad_sessions')
      .select('*')
      .eq('link_id', link.id)
      .eq('visitor_telegram_id', visitorId)
      .in('status', ['AD_1_STARTED', 'AD_2_STARTED', 'REWARD_ELIGIBLE'])
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    if (existingActiveSessions && existingActiveSessions.length > 0) {
      const active = existingActiveSessions[0];
      const activeStep = active.step;
      const challengeToken = createAdChallengeToken({
        session_id: active.id,
        short_code: link.short_code,
        step: activeStep,
        visitor_id: visitorId,
        ip_hash: ipHash,
        is_owner: isOwner,
        is_eligible: active.metadata?.is_eligible ?? fraudEval.isEligible,
        min_duration_ms: minDurationMs,
        created_at: now,
        expires_at: new Date(active.expires_at).getTime()
      });

      return sendSuccess(res, {
        session_id: active.id,
        short_code: link.short_code,
        step: activeStep,
        total_steps: 2,
        network: 'MONETAG',
        status: active.status,
        challenge_token: challengeToken,
        timer_seconds: 5,
        is_owner: isOwner,
        is_eligible: active.metadata?.is_eligible ?? fraudEval.isEligible,
        resumed: true
      });
    }

    // 5. Create new ad_sessions record
    const { data: adSession, error: sessionErr } = await supabase
      .from('ad_sessions')
      .insert([
        {
          link_id: link.id,
          visitor_telegram_id: visitorId,
          step: 1,
          network: 'MONETAG',
          status: 'AD_1_STARTED',
          challenge_hash: ipHash,
          started_at: new Date(now).toISOString(),
          expires_at: new Date(expiresAt).toISOString(),
          metadata: {
            is_owner: isOwner,
            is_eligible: fraudEval.isEligible,
            ineligible_reason: fraudEval.reason,
            fraud_score: fraudEval.score,
            fraud_status: fraudEval.status,
            ip_hash: ipHash,
            ua_hash: uaHash
          }
        }
      ])
      .select('id, step, status')
      .single();

    if (sessionErr || !adSession) {
      throw sessionErr || new Error('Failed to create ad session');
    }

    // 6. Record Initial AD_STARTED event in ad_events table
    const startEventId = `START_1_${adSession.id}`;
    await supabase.from('ad_events').insert([
      {
        ad_session_id: adSession.id,
        visitor_telegram_id: visitorId,
        link_id: link.id,
        step: 1,
        network: 'MONETAG',
        event_type: 'AD_STARTED',
        event_id: startEventId,
        idempotency_key: `EVENT:${startEventId}`,
        metadata: {
          ip_hash: ipHash,
          ua_hash: uaHash,
          fraud_score: fraudEval.score
        }
      }
    ]);

    // 7. Generate Step 1 HMAC Challenge Token
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

    return sendSuccess(res, {
      session_id: adSession.id,
      short_code: link.short_code,
      step: 1,
      total_steps: 2,
      network: 'MONETAG',
      status: 'AD_1_STARTED',
      challenge_token: challengeToken,
      timer_seconds: 5,
      is_owner: isOwner,
      is_eligible: fraudEval.isEligible,
      ineligible_reason: fraudEval.reason,
      resumed: false
    });
  } catch (error) {
    console.error('[Ad Session Start Error]:', error);
    return sendError(res, error.message || 'Error starting ad session', 500);
  }
};
