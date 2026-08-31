/** TeleShort v2.2 — Monetag Ad Session Start */
const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { verifyTelegramWebAppData } = require('../utils/auth');
const { checkChatMember } = require('../utils/telegram');
const { evaluateVisitorFraud } = require('../utils/fraud');
const { createAdChallengeToken, getClientIp, hashIp, hashUserAgent } = require('../utils/crypto');
const { checkRateLimit } = require('../utils/ratelimit');
const { getSupabaseClient } = require('../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return sendError(res, 'Method Not Allowed', 405);
  const { short_code, initData } = req.body || {};
  if (!short_code) return sendError(res, 'Short code is required', 400, 'MISSING_SHORT_CODE');

  const auth = verifyTelegramWebAppData(initData || req.headers['x-telegram-init-data'], process.env.BOT_TOKEN);
  if (!auth.valid || !auth.user) return sendError(res, auth.error || 'Invalid Telegram authentication signature', 401, 'INVALID_AUTH');
  const visitorId = Number(auth.user.id);
  const rateLimit = await checkRateLimit(`ad_start_${visitorId}`, 'ad_session_start', 10, 60);
  if (!rateLimit.allowed) return sendError(res, 'Too many ad session requests. Please wait a moment.', 429, 'RATE_LIMITED');

  try {
    const supabase = getSupabaseClient();
    const cleanCode = String(short_code).replace(/^link_/, '').trim();
    const { data: link, error: linkErr } = await supabase.from('links').select('id,short_code,short_id,owner_id,status').eq('short_code', cleanCode).maybeSingle();
    if (linkErr) throw linkErr;
    if (!link) return sendError(res, 'Link not found', 404, 'LINK_NOT_FOUND');
    if (link.status !== 'ACTIVE') return sendError(res, `Link is ${String(link.status).toLowerCase()} and cannot be unlocked`, 403, 'LINK_NOT_ACTIVE');

    const { data: owner, error: ownerErr } = await supabase.from('users').select('telegram_id,status,is_blocked').eq('id', link.owner_id).maybeSingle();
    if (ownerErr) throw ownerErr;
    if (!owner) return sendError(res, 'Link owner not found', 404, 'OWNER_NOT_FOUND');
    if (owner.status === 'BANNED' || owner.status === 'SUSPENDED' || owner.is_blocked === true) return sendError(res, 'This link is unavailable', 410, 'OWNER_RESTRICTED');

    const isOwner = Number(owner.telegram_id) === visitorId;
    const ipHash = hashIp(getClientIp(req));
    const userAgent = req.headers['user-agent'] || '';
    const fraudEval = await evaluateVisitorFraud({ ownerId: owner.telegram_id, visitorId, linkId: link.id, ipHash, userAgent, recentRequestsCount: rateLimit.count });

    const { data: settingsRecord } = await supabase.from('settings').select('value').eq('key', 'force_join_config').maybeSingle();
    const forceJoinConfig = settingsRecord?.value || { enabled: false };
    if (forceJoinConfig.enabled && forceJoinConfig.channel_id) {
      const memberCheck = await checkChatMember(forceJoinConfig.channel_id, visitorId, false);
      if (!memberCheck.joined) return sendError(res, 'You must join the official channel before watching ads', 403, 'FORCE_JOIN_REQUIRED');
    }

    const expiresAt = Date.now() + 5 * 60 * 1000;
    const { data: active } = await supabase.from('ad_sessions').select('*').eq('link_id', link.id).eq('visitor_telegram_id', visitorId).in('status', ['AD_1_STARTED', 'AD_2_STARTED']).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1);
    if (active && active.length) {
      const a = active[0];
      const eligible = Boolean(a.metadata?.is_eligible);
      const token = createAdChallengeToken({ session_id: a.id, short_code: link.short_code || link.short_id, step: a.step, visitor_id: visitorId, ip_hash: ipHash, is_owner: isOwner, is_eligible: eligible, min_duration_ms: 4500, created_at: Date.now(), expires_at: new Date(a.expires_at).getTime() });
      return sendSuccess(res, { session_id: a.id, short_code: link.short_code || link.short_id, step: a.step, total_steps: 2, network: 'MONETAG', status: a.status, challenge_token: token, timer_seconds: 5, is_owner: isOwner, is_eligible: eligible, resumed: true });
    }

    const eligible = Boolean(fraudEval.isEligible && !isOwner);
    const { data: adSession, error: sessionErr } = await supabase.from('ad_sessions').insert([{
      link_id: link.id,
      visitor_telegram_id: visitorId,
      step: 1,
      network: 'MONETAG',
      status: 'AD_1_STARTED',
      challenge_hash: ipHash,
      started_at: new Date().toISOString(),
      expires_at: new Date(expiresAt).toISOString(),
      metadata: { is_owner: isOwner, is_eligible: eligible, ineligible_reason: isOwner ? 'SELF_CLICK' : fraudEval.reason, fraud_score: fraudEval.score, fraud_status: fraudEval.status, ip_hash: ipHash, ua_hash: hashUserAgent(userAgent) }
    }]).select('id,step,status').single();
    if (sessionErr) throw sessionErr;

    const startEventId = `START_1_${adSession.id}`;
    await supabase.from('ad_events').insert([{ ad_session_id: adSession.id, visitor_telegram_id: visitorId, link_id: link.id, step: 1, network: 'MONETAG', event_type: 'AD_STARTED', event_id: startEventId, idempotency_key: `EVENT:${startEventId}`, metadata: { ip_hash: ipHash, ua_hash: hashUserAgent(userAgent), fraud_score: fraudEval.score } }]);
    const challengeToken = createAdChallengeToken({ session_id: adSession.id, short_code: link.short_code || link.short_id, step: 1, visitor_id: visitorId, ip_hash: ipHash, is_owner: isOwner, is_eligible: eligible, min_duration_ms: 4500, created_at: Date.now(), expires_at: expiresAt });
    return sendSuccess(res, { session_id: adSession.id, short_code: link.short_code || link.short_id, step: 1, total_steps: 2, network: 'MONETAG', status: 'AD_1_STARTED', challenge_token: challengeToken, timer_seconds: 5, is_owner: isOwner, is_eligible: eligible, ineligible_reason: isOwner ? 'SELF_CLICK' : fraudEval.reason, resumed: false });
  } catch (error) {
    console.error('[Ad Session Start Error]:', error);
    return sendError(res, error.message || 'Error starting ad session', 500, 'AD_SESSION_START_ERROR');
  }
};
