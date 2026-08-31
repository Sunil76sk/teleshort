/**
 * TeleShort v2.1 — Visitor Link Resolution Endpoint
 * POST /api/visitor/resolve
 * Resolves short links, checks status, runs self-click & duplicate checks, and evaluates Force Join.
 */

const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { verifyTelegramWebAppData } = require('../utils/auth');
const { checkChatMember } = require('../utils/telegram');
const { evaluateVisitorFraud } = require('../utils/fraud');
const { getClientIp, hashIp, hashUserAgent } = require('../utils/crypto');
const { checkRateLimit } = require('../utils/ratelimit');
const { getSupabaseClient } = require('../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return sendError(res, 'Method Not Allowed', 405);
  }

  const rawCode = req.body?.short_code || req.body?.short_id || req.query?.short_code || req.query?.code;
  if (!rawCode) {
    return sendError(res, 'Short code is required', 400, 'MISSING_SHORT_CODE');
  }

  const cleanCode = String(rawCode).replace(/^link_/, '').trim();
  if (!cleanCode || !cleanCode.match(/^[a-zA-Z0-9_-]{3,32}$/)) {
    return sendError(res, 'Invalid short code format', 400, 'INVALID_SHORT_CODE');
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

  // Sliding window rate limit on link resolution
  const rateLimit = await checkRateLimit(`visitor_${visitorId}`, 'resolve_link', 30, 60);
  if (!rateLimit.allowed) {
    return sendError(res, 'Too many link lookups. Please slow down.', 429, 'RATE_LIMITED');
  }

  try {
    const supabase = getSupabaseClient();

    // 1. Lookup Link in Database (query short_code first, fallback to short_id)
    let { data: link, error: linkErr } = await supabase
      .from('links')
      .select('id, short_code, owner_id, status, click_count, eligible_click_count, total_earnings')
      .eq('short_code', cleanCode)
      .single();

    if (linkErr || !link) {
      const { data: fallbackLink } = await supabase
        .from('links')
        .select('id, short_code, owner_id, status, click_count, eligible_click_count, total_earnings')
        .eq('short_id', cleanCode)
        .single();
      link = fallbackLink;
    }

    if (!link) {
      return sendError(res, 'Link not found or has been removed', 404, 'LINK_NOT_FOUND');
    }

    // 2. Check Link Status
    if (link.status === 'DISABLED') {
      return sendError(res, 'This link has been disabled by its owner', 410, 'LINK_DISABLED');
    }
    if (link.status === 'EXPIRED') {
      return sendError(res, 'This link has expired', 410, 'LINK_EXPIRED');
    }
    if (link.status === 'FLAGGED') {
      return sendError(res, 'This link has been flagged for violation of terms', 403, 'LINK_FLAGGED');
    }

    // 3. Evaluate Fraud, Self-Click & Cooldown Signals
    const fraudEval = await evaluateVisitorFraud({
      ownerId: link.owner_id,
      visitorId,
      linkId: link.id,
      ipHash,
      userAgent,
      recentRequestsCount: rateLimit.count
    });

    const isSelfClick = (String(link.owner_id) === String(visitorId));

    // 4. Force Join Check
    const { data: settingsRecord } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'force_join_config')
      .single();

    const forceJoinConfig = settingsRecord?.value || { enabled: false };
    let forceJoinRequired = Boolean(forceJoinConfig.enabled && forceJoinConfig.channel_id);
    let forceJoinPassed = true;
    let channelInfo = null;

    if (forceJoinRequired) {
      channelInfo = {
        channel_id: forceJoinConfig.channel_id,
        invite_link: forceJoinConfig.invite_link || `https://t.me/${forceJoinConfig.channel_id.replace('@', '')}`
      };

      const memberCheck = await checkChatMember(forceJoinConfig.channel_id, visitorId, false);
      forceJoinPassed = memberCheck.joined;
    }

    return sendSuccess(res, {
      resolved: true,
      short_code: link.short_code,
      link_id: link.id,
      is_owner: isSelfClick,
      is_eligible: fraudEval.isEligible,
      ineligible_reason: fraudEval.reason,
      fraud_status: fraudEval.status,
      force_join_required: forceJoinRequired,
      force_join_passed: forceJoinPassed,
      channel: channelInfo
    });
  } catch (error) {
    console.error('[Visitor Resolve Error]:', error);
    return sendError(res, error.message || 'Error resolving link', 500);
  }
};
