/**
 * TeleShort — Force Join Channel Verification Endpoint
 * POST /api/visitor/force-join
 * Verifies membership in every required channel.
 */

const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { verifyTelegramWebAppData } = require('../utils/auth');
const { checkChatMember } = require('../utils/telegram');
const { checkRateLimit } = require('../utils/ratelimit');
const { loadRequiredChannels } = require('./force-join-config');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return sendError(res, 'Method Not Allowed', 405);
  }

  const { initData, force_refresh = false } = req.body || {};
  const botToken = process.env.BOT_TOKEN;

  const auth = verifyTelegramWebAppData(initData, botToken);
  if (!auth.valid || !auth.user) {
    return sendError(res, auth.error || 'Invalid Telegram authentication signature', 401, 'INVALID_AUTH');
  }

  const visitorId = auth.user.id;
  const rateLimit = await checkRateLimit(`fj_${visitorId}`, 'force_join_check', 20, 60);
  if (!rateLimit.allowed) {
    return sendError(res, 'Too many verification attempts. Please wait a few seconds.', 429, 'RATE_LIMITED');
  }

  try {
    const requiredChannels = await loadRequiredChannels();

    if (!requiredChannels.length) {
      return sendSuccess(res, {
        joined: true,
        channels: [],
        message: 'Force Join is disabled.'
      });
    }

    const results = await Promise.all(
      requiredChannels.map(async (channel) => {
        const result = await checkChatMember(
          channel.channel_id,
          visitorId,
          Boolean(force_refresh)
        );

        return {
          channel_id: channel.channel_id,
          username: channel.username,
          url: channel.url,
          joined: Boolean(result.joined),
          status: result.status,
          cached: Boolean(result.cached),
          error: result.joined ? undefined : result.error
        };
      })
    );

    const joined = results.every((item) => item.joined === true);

    return sendSuccess(res, {
      joined,
      status: joined ? 'ALL_JOINED' : 'JOIN_REQUIRED',
      cached: results.some((item) => item.cached),
      channel_id: results[0]?.channel_id,
      channel_url: results[0]?.url,
      channels: results
    });
  } catch (error) {
    console.error('[Force Join Verification Error]:', error);
    return sendError(
      res,
      error.message || 'Membership verification failed',
      500,
      'FORCE_JOIN_CHECK_FAILED'
    );
  }
};
