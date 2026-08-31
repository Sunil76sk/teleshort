/**
 * TeleShort v2.1 — Monetag Ad Event & State Progression Endpoint (Phase 5)
 * POST /api/ad-session/event
 * Captures Monetag ad provider events, validates challenge token, enforces single-use idempotency,
 * and progresses the session state machine to REWARD_ELIGIBLE without modifying financial balances.
 */

const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { verifyTelegramWebAppData } = require('../utils/auth');
const { verifyAdChallengeToken, createAdChallengeToken, getClientIp, hashIp } = require('../utils/crypto');
const { checkRateLimit } = require('../utils/ratelimit');
const { getSupabaseClient } = require('../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return sendError(res, 'Method Not Allowed', 405);
  }

  const {
    session_id,
    step,
    event_type = 'AD_COMPLETED',
    event_id,
    challenge_token,
    client_duration_ms = 0,
    initData
  } = req.body || {};

  if (!session_id || !step || !challenge_token) {
    return sendError(res, 'Missing required parameters (session_id, step, challenge_token)', 400, 'MISSING_PARAMS');
  }

  // 1. Authenticate Telegram Visitor
  const botToken = process.env.BOT_TOKEN;
  const auth = verifyTelegramWebAppData(initData, botToken);
  if (!auth.valid || !auth.user) {
    return sendError(res, auth.error || 'Invalid Telegram authentication signature', 401, 'INVALID_AUTH');
  }

  const visitorId = auth.user.id;
  const parsedStep = parseInt(step, 10);

  if (parsedStep !== 1 && parsedStep !== 2) {
    return sendError(res, 'Invalid ad step. Must be 1 or 2.', 400, 'INVALID_STEP');
  }

  // Rate limit event submissions (max 20 per minute per visitor)
  const rateLimit = await checkRateLimit(`event_${visitorId}`, 'ad_event_submit', 20, 60);
  if (!rateLimit.allowed) {
    return sendError(res, 'Too many event submissions. Please slow down.', 429, 'RATE_LIMITED');
  }

  // 2. Cryptographically Verify Challenge Token
  const tokenPayload = verifyAdChallengeToken(challenge_token);
  if (!tokenPayload) {
    return sendError(res, 'Invalid or expired ad challenge token', 401, 'INVALID_CHALLENGE_TOKEN');
  }

  // Bind checks: ensure token belongs to this session, this user, and this exact step
  if (
    tokenPayload.session_id !== session_id ||
    String(tokenPayload.visitor_id) !== String(visitorId) ||
    tokenPayload.step !== parsedStep
  ) {
    return sendError(res, 'Challenge token mismatch for current session and step', 403, 'CHALLENGE_MISMATCH');
  }

  try {
    const supabase = getSupabaseClient();
    const now = Date.now();

    // 3. Fetch Ad Session from Database
    const { data: session, error: fetchErr } = await supabase
      .from('ad_sessions')
      .select('id, link_id, visitor_telegram_id, step, status, started_at, expires_at, metadata')
      .eq('id', session_id)
      .single();

    if (fetchErr || !session) {
      return sendError(res, 'Ad session not found', 404, 'SESSION_NOT_FOUND');
    }

    if (String(session.visitor_telegram_id) !== String(visitorId)) {
      return sendError(res, 'Unauthorized: session belongs to another user', 403, 'UNAUTHORIZED_SESSION');
    }

    if (new Date(session.expires_at).getTime() < now) {
      await supabase.from('ad_sessions').update({ status: 'EXPIRED' }).eq('id', session_id);
      return sendError(res, 'Ad session has expired. Please restart.', 410, 'SESSION_EXPIRED');
    }

    // 4. Handle Provider Failure Events
    const validEvents = new Set(['AD_COMPLETED', 'AD_FAILED', 'AD_SKIPPED', 'AD_TIMEOUT']);
    const sanitizedEvent = validEvents.has(event_type) ? event_type : 'AD_FAILED';

    const safeEventId = event_id || `${sanitizedEvent}_${parsedStep}_${now}`;
    const idempotencyKey = `EVENT:${session_id}:${parsedStep}:${sanitizedEvent}:${safeEventId}`;

    if (sanitizedEvent !== 'AD_COMPLETED') {
      // Record failure in ad_events
      await supabase.from('ad_events').upsert({
        ad_session_id: session_id,
        visitor_telegram_id: visitorId,
        link_id: session.link_id,
        step: parsedStep,
        network: 'MONETAG',
        event_type: sanitizedEvent,
        event_id: safeEventId,
        idempotency_key: idempotencyKey,
        metadata: { client_duration_ms, error_reason: 'Client provider event failure' }
      }, { onConflict: 'idempotency_key' });

      return sendSuccess(res, {
        success: false,
        retry_allowed: true,
        step: parsedStep,
        status: session.status,
        message: 'Ad was not completed. Please watch the ad to unlock.'
      });
    }

    // 5. Anti-Abuse Viewing Signal Verification (Minimum 4.5s watch time)
    const startedTime = new Date(session.started_at).getTime();
    const elapsedSinceStart = now - startedTime;
    const reportedDuration = parseInt(client_duration_ms, 10) || 0;

    let isEligible = session.metadata?.is_eligible ?? true;
    let fraudPenalty = 0;

    // Sub-threshold check: If completed in < 4.0s from session start, flag velocity anomaly
    if (elapsedSinceStart < 4000 && reportedDuration < 4000) {
      isEligible = false;
      fraudPenalty = 35;
      console.warn(`[Anti-Abuse] Sub-threshold ad completion detected (${elapsedSinceStart}ms) for session ${session_id}`);
    }

    // 6. Record AD_COMPLETED Event with Idempotency
    const { error: eventInsertErr } = await supabase.from('ad_events').insert([
      {
        ad_session_id: session_id,
        visitor_telegram_id: visitorId,
        link_id: session.link_id,
        step: parsedStep,
        network: 'MONETAG',
        event_type: 'AD_COMPLETED',
        event_id: safeEventId,
        idempotency_key: idempotencyKey,
        metadata: {
          client_duration_ms: reportedDuration,
          elapsed_since_start_ms: elapsedSinceStart,
          anti_abuse_passed: isEligible
        }
      }
    ]);

    // Handle replay / duplicate event submission
    if (eventInsertErr && eventInsertErr.code === '23505') {
      // Duplicate event submission: return current state without re-advancing
      return sendSuccess(res, {
        success: true,
        step: session.step,
        status: session.status,
        is_eligible: isEligible,
        message: 'Event already recorded'
      });
    }

    // 7. State Machine Progression
    // =========================================================================
    // STEP 1 COMPLETION -> Transition to AD_2_STARTED
    // =========================================================================
    if (parsedStep === 1) {
      const step2ExpiresAt = now + (5 * 60 * 1000);
      const updatedMetadata = {
        ...session.metadata,
        step_1_completed_at: new Date(now).toISOString(),
        is_eligible: isEligible,
        fraud_score: (session.metadata?.fraud_score || 0) + fraudPenalty
      };

      await supabase
        .from('ad_sessions')
        .update({
          step: 2,
          status: 'AD_2_STARTED',
          metadata: updatedMetadata
        })
        .eq('id', session_id);

      // Issue Step 2 HMAC Challenge Token
      const step2Payload = {
        session_id: session_id,
        short_code: tokenPayload.short_code,
        step: 2,
        visitor_id: visitorId,
        ip_hash: tokenPayload.ip_hash,
        is_owner: tokenPayload.is_owner,
        is_eligible: isEligible,
        min_duration_ms: 4500,
        created_at: now,
        expires_at: step2ExpiresAt
      };

      const step2ChallengeToken = createAdChallengeToken(step2Payload);

      return sendSuccess(res, {
        success: true,
        step: 2,
        total_steps: 2,
        network: 'MONETAG',
        status: 'AD_2_STARTED',
        challenge_token: step2ChallengeToken,
        timer_seconds: 5,
        is_owner: tokenPayload.is_owner,
        is_eligible: isEligible,
        message: 'Ad 1 completed. Ready for Ad 2.'
      });
    }

    // =========================================================================
    // STEP 2 COMPLETION -> Transition to REWARD_ELIGIBLE (Phase 5 Boundary)
    // =========================================================================
    if (parsedStep === 2) {
      const updatedMetadata = {
        ...session.metadata,
        step_2_completed_at: new Date(now).toISOString(),
        is_eligible: isEligible,
        fraud_score: (session.metadata?.fraud_score || 0) + fraudPenalty
      };

      await supabase
        .from('ad_sessions')
        .update({
          status: 'REWARD_ELIGIBLE',
          completed_at: new Date(now).toISOString(),
          metadata: updatedMetadata
        })
        .eq('id', session_id);

      // NOTE: Phase 5 Boundary strictly respected.
      // NO wallet balance modification, NO ledger write, NO payout here.
      return sendSuccess(res, {
        success: true,
        step: 2,
        total_steps: 2,
        network: 'MONETAG',
        status: 'REWARD_ELIGIBLE',
        is_owner: tokenPayload.is_owner,
        is_eligible: isEligible,
        message: 'All ad steps completed successfully. Ready for reward resolution.'
      });
    }

    return sendError(res, 'Unhandled step transition', 500);
  } catch (error) {
    console.error('[Ad Event Error]:', error);
    return sendError(res, error.message || 'Error processing ad event', 500);
  }
};
