/** TeleShort v2.2 — Monetag Ad Event & State Progression */
const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { verifyTelegramWebAppData } = require('../utils/auth');
const { verifyAdChallengeToken, createAdChallengeToken } = require('../utils/crypto');
const { checkRateLimit } = require('../utils/ratelimit');
const { getSupabaseClient } = require('../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return sendError(res, 'Method Not Allowed', 405);
  const { session_id, step, event_type = 'AD_COMPLETED', event_id, challenge_token, client_duration_ms = 0, initData } = req.body || {};
  if (!session_id || !step || !challenge_token) return sendError(res, 'Missing required parameters (session_id, step, challenge_token)', 400, 'MISSING_PARAMS');

  const auth = verifyTelegramWebAppData(initData || req.headers['x-telegram-init-data'], process.env.BOT_TOKEN);
  if (!auth.valid || !auth.user) return sendError(res, auth.error || 'Invalid Telegram authentication signature', 401, 'INVALID_AUTH');
  const visitorId = Number(auth.user.id);
  const parsedStep = parseInt(step, 10);
  if (![1, 2].includes(parsedStep)) return sendError(res, 'Invalid ad step. Must be 1 or 2.', 400, 'INVALID_STEP');
  const rateLimit = await checkRateLimit(`event_${visitorId}`, 'ad_event_submit', 20, 60);
  if (!rateLimit.allowed) return sendError(res, 'Too many event submissions. Please slow down.', 429, 'RATE_LIMITED');

  const tokenPayload = verifyAdChallengeToken(challenge_token);
  if (!tokenPayload) return sendError(res, 'Invalid or expired ad challenge token', 401, 'INVALID_CHALLENGE_TOKEN');
  if (tokenPayload.session_id !== session_id || String(tokenPayload.visitor_id) !== String(visitorId) || Number(tokenPayload.step) !== parsedStep) return sendError(res, 'Challenge token mismatch for current session and step', 403, 'CHALLENGE_MISMATCH');

  try {
    const supabase = getSupabaseClient();
    const now = Date.now();
    const { data: session, error: fetchErr } = await supabase.from('ad_sessions').select('id,link_id,visitor_telegram_id,step,status,started_at,expires_at,metadata').eq('id', session_id).single();
    if (fetchErr || !session) return sendError(res, 'Ad session not found', 404, 'SESSION_NOT_FOUND');
    if (String(session.visitor_telegram_id) !== String(visitorId)) return sendError(res, 'Unauthorized: session belongs to another user', 403, 'UNAUTHORIZED_SESSION');
    if (session.step !== parsedStep) return sendError(res, 'Ad session step mismatch', 409, 'SESSION_STEP_MISMATCH');

    const expectedStatus = parsedStep === 1 ? 'AD_1_STARTED' : 'AD_2_STARTED';
    if (session.status !== expectedStatus) return sendError(res, 'This ad step is no longer active and cannot be replayed', 409, 'AD_STEP_NOT_ACTIVE');
    if (new Date(session.expires_at).getTime() < now) {
      await supabase.from('ad_sessions').update({ status: 'EXPIRED', updated_at: new Date().toISOString() }).eq('id', session_id);
      return sendError(res, 'Ad session has expired. Please restart.', 410, 'SESSION_EXPIRED');
    }

    const validEvents = new Set(['AD_COMPLETED', 'AD_FAILED', 'AD_SKIPPED', 'AD_TIMEOUT']);
    const sanitizedEvent = validEvents.has(event_type) ? event_type : 'AD_FAILED';
    const safeEventId = event_id || `${sanitizedEvent}_${parsedStep}_${now}`;
    const idempotencyKey = `EVENT:${session_id}:${parsedStep}:${sanitizedEvent}:${safeEventId}`;

    if (sanitizedEvent !== 'AD_COMPLETED') {
      await supabase.from('ad_events').upsert({ ad_session_id: session_id, visitor_telegram_id: visitorId, link_id: session.link_id, step: parsedStep, network: 'MONETAG', event_type: sanitizedEvent, event_id: safeEventId, idempotency_key: idempotencyKey, metadata: { client_duration_ms: Number(client_duration_ms) || 0 } }, { onConflict: 'idempotency_key' });
      return sendSuccess(res, { success: false, retry_allowed: true, step: parsedStep, status: session.status, message: 'Ad was not completed. Please watch the ad to unlock.' });
    }

    const elapsedSinceStart = now - new Date(session.started_at).getTime();
    const reportedDuration = Math.max(0, parseInt(client_duration_ms, 10) || 0);
    if (elapsedSinceStart < 4500 || reportedDuration < 4500) {
      await supabase.from('ad_events').upsert({ ad_session_id: session_id, visitor_telegram_id: visitorId, link_id: session.link_id, step: parsedStep, network: 'MONETAG', event_type: 'AD_FAILED', event_id: `TOO_SHORT_${safeEventId}`, idempotency_key: `EVENT:${session_id}:${parsedStep}:TOO_SHORT:${safeEventId}`, metadata: { client_duration_ms: reportedDuration, elapsed_since_start_ms: elapsedSinceStart } }, { onConflict: 'idempotency_key' });
      return sendError(res, 'Ad completion was too fast. Please watch the ad fully.', 400, 'WATCH_TIME_TOO_SHORT');
    }

    const isEligible = Boolean(session.metadata?.is_eligible);
    const { error: eventErr } = await supabase.from('ad_events').insert([{ ad_session_id: session_id, visitor_telegram_id: visitorId, link_id: session.link_id, step: parsedStep, network: 'MONETAG', event_type: 'AD_COMPLETED', event_id: safeEventId, idempotency_key: idempotencyKey, metadata: { client_duration_ms: reportedDuration, elapsed_since_start_ms: elapsedSinceStart, anti_abuse_passed: true } }]);
    if (eventErr && eventErr.code === '23505') return sendSuccess(res, { success: true, step: session.step, status: session.status, is_eligible: isEligible, message: 'Event already recorded' });
    if (eventErr) throw eventErr;

    if (parsedStep === 1) {
      const step2ExpiresAt = now + 5 * 60 * 1000;
      const updatedMetadata = { ...(session.metadata || {}), step_1_completed_at: new Date(now).toISOString() };
      const { error: updateErr } = await supabase.from('ad_sessions').update({ step: 2, status: 'AD_2_STARTED', metadata: updatedMetadata, updated_at: new Date().toISOString() }).eq('id', session_id).eq('status', 'AD_1_STARTED');
      if (updateErr) throw updateErr;
      const step2Token = createAdChallengeToken({ session_id, short_code: tokenPayload.short_code, step: 2, visitor_id: visitorId, ip_hash: tokenPayload.ip_hash, is_owner: tokenPayload.is_owner, is_eligible: isEligible, min_duration_ms: 4500, created_at: now, expires_at: step2ExpiresAt });
      return sendSuccess(res, { success: true, step: 2, total_steps: 2, network: 'MONETAG', status: 'AD_2_STARTED', challenge_token: step2Token, timer_seconds: 5, is_owner: tokenPayload.is_owner, is_eligible: isEligible, message: 'Ad 1 completed. Ready for Ad 2.' });
    }

    const updatedMetadata = { ...(session.metadata || {}), step_2_completed_at: new Date(now).toISOString(), is_eligible: isEligible };
    const { error: finalErr } = await supabase.from('ad_sessions').update({ status: 'REWARD_ELIGIBLE', completed_at: new Date(now).toISOString(), metadata: updatedMetadata, updated_at: new Date().toISOString() }).eq('id', session_id).eq('status', 'AD_2_STARTED');
    if (finalErr) throw finalErr;
    return sendSuccess(res, { success: true, step: 2, total_steps: 2, network: 'MONETAG', status: 'REWARD_ELIGIBLE', is_owner: tokenPayload.is_owner, is_eligible: isEligible, message: 'All ad steps completed successfully. Ready for reward resolution.' });
  } catch (error) {
    console.error('[Ad Event Error]:', error);
    return sendError(res, error.message || 'Error processing ad event', 500, 'AD_EVENT_ERROR');
  }
};
