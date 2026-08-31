/**
 * TeleShort v2.1 — Force Join Channel Verification Endpoint
 * POST /api/visitor/force-join
 * Verifies channel membership with Upstash Redis caching and supports immediate re-check on "I've Joined".
 */

const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { verifyTelegramWebAppData } = require('../utils/auth');
const { checkChatMember } = require('../utils/telegram');
const { checkRateLimit } = require('../utils/ratelimit');
const { getSupabaseClient } = require('../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return sendError(res, 'Method Not Allowed', 405);
  }

  const { initData, channel_id, force_refresh = false } = req.body || {};
  const botToken = process.env.BOT_TOKEN;

  const auth = verifyTelegramWebAppData(initData, botToken);
  if (!auth.valid || !auth.user) {
    return sendError(res, auth.error || 'Invalid Telegram authentication signature', 401, 'INVALID_AUTH');
  }

  const visitorId = auth.user.id;

  // Rate limit membership checks (max 20 per minute per user)
  const rateLimit = await checkRateLimit(`fj_${visitorId}`, 'force_join_check', 20, 60);
  if (!rateLimit.allowed) {
    return sendError(res, 'Too many verification attempts. Please wait a few seconds.', 429, 'RATE_LIMITED');
  }

  try {
    let targetChannel = channel_id;

    // If channel_id not explicitly sent, read from active settings
    if (!targetChannel) {
      const supabase = getSupabaseClient();
      const { data: settingsRecord } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'force_join_config')
        .single();

      targetChannel = settingsRecord?.value?.channel_id;
    }

    if (!targetChannel) {
      return sendSuccess(res, { joined: true, message: 'Force Join is not currently configured.' });
    }

    // Perform check with optional cache bypass on "I've Joined" click
    const result = await checkChatMember(targetChannel, visitorId, Boolean(force_refresh));

    return sendSuccess(res, {
      joined: result.joined,
      status: result.status,
      cached: result.cached || false,
      channel_id: targetChannel
    });
  } catch (error) {
    console.error('[Force Join Verification Error]:', error);
    return sendError(res, error.message || 'Membership verification failed', 500);
  }
};
