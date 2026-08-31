/** TeleShort v2.1 — Visitor Link Resolution */
const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { verifyTelegramWebAppData } = require('../utils/auth');
const { checkChatMember } = require('../utils/telegram');
const { evaluateVisitorFraud } = require('../utils/fraud');
const { getClientIp, hashIp, hashUserAgent } = require('../utils/crypto');
const { checkRateLimit } = require('../utils/ratelimit');
const { getSupabaseClient } = require('../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return sendError(res, 'Method Not Allowed', 405);
  const rawCode = req.body?.short_code || req.body?.short_id || req.query?.short_code || req.query?.code;
  if (!rawCode) return sendError(res, 'Short code is required', 400, 'MISSING_SHORT_CODE');
  const cleanCode = String(rawCode).replace(/^link_/,'').trim();
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(cleanCode)) return sendError(res, 'Invalid short code format', 400, 'INVALID_SHORT_CODE');

  const initData = req.headers['x-telegram-init-data'] || req.body?.initData || req.query?.initData;
  const auth = verifyTelegramWebAppData(initData, process.env.BOT_TOKEN);
  if (!auth.valid || !auth.user) return sendError(res, auth.error || 'Invalid Telegram authentication signature', 401, 'INVALID_AUTH');
  const visitorId = Number(auth.user.id);
  if (!Number.isSafeInteger(visitorId) || visitorId <= 0) return sendError(res, 'Invalid Telegram user ID', 400, 'INVALID_TELEGRAM_USER');

  const rateLimit = await checkRateLimit(`visitor_${visitorId}`, 'resolve_link', 30, 60);
  if (!rateLimit.allowed) return sendError(res, 'Too many link lookups. Please slow down.', 429, 'RATE_LIMITED');

  try {
    const supabase = getSupabaseClient();
    let { data: link, error: linkErr } = await supabase.from('links').select('id,short_code,short_id,owner_id,status,click_count,eligible_click_count,total_earnings,original_url').eq('short_code', cleanCode).maybeSingle();
    if (linkErr) throw linkErr;
    if (!link) {
      const fallback = await supabase.from('links').select('id,short_code,short_id,owner_id,status,click_count,eligible_click_count,total_earnings,original_url').eq('short_id', cleanCode).maybeSingle();
      if (fallback.error) throw fallback.error;
      link = fallback.data;
    }
    if (!link) return sendError(res, 'Link not found or has been removed', 404, 'LINK_NOT_FOUND');
    if (link.status !== 'ACTIVE') return sendError(res, `This link is ${String(link.status).toLowerCase()} and cannot be unlocked`, 410, `LINK_${String(link.status).toUpperCase()}`);

    const { data: owner, error: ownerErr } = await supabase.from('users').select('id,telegram_id,status,is_blocked').eq('id', link.owner_id).maybeSingle();
    if (ownerErr) throw ownerErr;
    if (!owner) return sendError(res, 'Link owner account not found', 404, 'OWNER_NOT_FOUND');
    if (owner.status === 'BANNED' || owner.status === 'SUSPENDED' || owner.is_blocked === true) return sendError(res, 'This link is unavailable', 410, 'OWNER_RESTRICTED');

    const clientIp = getClientIp(req);
    const ipHash = hashIp(clientIp);
    const userAgent = req.headers['user-agent'] || '';
    const uaHash = hashUserAgent(userAgent);
    const isSelfClick = Number(owner.telegram_id) === visitorId;

    const fraudEval = await evaluateVisitorFraud({ ownerId: owner.telegram_id, visitorId, linkId: link.id, ipHash, userAgent, recentRequestsCount: rateLimit.count });

    // Record the visit once per visitor/link/cooldown window. This record is later upgraded to eligible by the reward transaction.
    const { data: recentClick } = await supabase.from('clicks').select('id').eq('link_id', link.id).eq('visitor_telegram_id', visitorId).gte('created_at', new Date(Date.now()-24*60*60*1000).toISOString()).limit(1).maybeSingle();
    const isUnique = !recentClick;
    if (isUnique) {
      const { error: clickErr } = await supabase.from('clicks').insert([{ link_id:link.id, visitor_telegram_id:visitorId, ip_hash:ipHash, user_agent_hash:uaHash, is_unique:true, is_eligible:false, reward_amount:0, fraud_score:fraudEval.score }]);
      if (clickErr) console.warn('[Visitor Click Log Warning]:', clickErr.message);
      await supabase.from('links').update({ click_count:Number(link.click_count||0)+1, updated_at:new Date().toISOString() }).eq('id',link.id);
    }

    const { data: settingsRecord } = await supabase.from('settings').select('value').eq('key','force_join_config').maybeSingle();
    const forceJoinConfig = settingsRecord?.value || { enabled:false };
    const forceJoinRequired = Boolean(forceJoinConfig.enabled && forceJoinConfig.channel_id);
    let forceJoinPassed = true;
    let channelInfo = null;
    if (forceJoinRequired) {
      channelInfo = { channel_id:forceJoinConfig.channel_id, invite_link:forceJoinConfig.invite_link || `https://t.me/${String(forceJoinConfig.channel_id).replace('@','')}` };
      const memberCheck = await checkChatMember(forceJoinConfig.channel_id, visitorId, false);
      forceJoinPassed = memberCheck.joined;
    }

    return sendSuccess(res, { resolved:true, short_code:link.short_code || link.short_id, link_id:link.id, is_owner:isSelfClick, is_eligible:isUnique && fraudEval.isEligible && !isSelfClick, ineligible_reason:isSelfClick?'SELF_CLICK':(!isUnique?'DUPLICATE_CLICK':fraudEval.reason), fraud_status:fraudEval.status, force_join_required:forceJoinRequired, force_join_passed:forceJoinPassed, channel:channelInfo });
  } catch (error) {
    console.error('[Visitor Resolve Error]:', error);
    return sendError(res, error.message || 'Error resolving link', 500, 'VISITOR_RESOLVE_ERROR');
  }
};
